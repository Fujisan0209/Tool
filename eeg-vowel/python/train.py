"""想像した母音（/a/ /e/ /i/ /o/ /u/）を脳波から分類し、ブラウザ用のモデルと評価結果を書き出します。

データ: Pressel Coretto, Gareis, Rufiner (2017) "Open access database of EEG signals
recorded during imagined speech" — 15人, 6ch (F3 F4 C3 C4 P3 P4), 1024 Hz, 2–45 Hz フィルタ済み。

評価のしかた（結果を甘く見積もらないための工夫）
  * 被験者ごとの「入れ子の交差検証」: 外側 5 分割で正解率を測り、設定（時間窓・周波数帯・分類器・
    正則化）は外側のテスト試行を見ずに、内側 5 分割だけで選ぶ。
  * ラベルをシャッフルした同じ手順を何度も回して「偶然でも出る正解率」の分布（置換検定）を作る。
  * 同じ手順で「想像か発声か」など別の問題も解き、パイプラインが壊れていないことを確かめる。

    python fetch_data.py
    python train.py                # ../data/results.json と ../data/demo.json を作る
    python train.py --perm 20      # 置換検定の回数を減らして速く試す
"""
import argparse, base64, json, os, time, warnings
import numpy as np
import scipy.io as sio
import scipy.signal as ss
from scipy import stats
from sklearn.discriminant_analysis import LinearDiscriminantAnalysis
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import balanced_accuracy_score
from sklearn.model_selection import GroupKFold, StratifiedKFold, cross_val_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore")
HERE = os.path.dirname(os.path.abspath(__file__))
FS = 128                      # 1024 Hz → 128 Hz に間引いて使う（データは 45 Hz 以下に帯域制限済み）
CH = ["F3", "F4", "C3", "C4", "P3", "P4"]
VOWELS = ["a", "e", "i", "o", "u"]
WORDS = ["arriba", "abajo", "derecha", "izquierda", "adelante", "atrás"]

# ---- 探索する設定（すべて「スペクトル特徴 + 線形分類器」なので、ブラウザでも同じ計算ができる） ----
WINDOWS = [(0.0, 4.0), (0.0, 3.0), (1.0, 4.0)]
BANDSETS = {
    "6帯域": [(2, 4), (4, 8), (8, 13), (13, 20), (20, 30), (30, 45)],
    "2Hz刻み": [(lo, lo + 2) for lo in range(2, 44, 2)],
}
CLASSIFIERS = {           # 正則化が強い（単純な）順。内側CVで同点なら先のものを選ぶ
    "ロジスティック回帰 C=0.01": lambda: LogisticRegression(C=0.01, max_iter=5000),
    "ロジスティック回帰 C=0.1": lambda: LogisticRegression(C=0.1, max_iter=5000),
    "ロジスティック回帰 C=1": lambda: LogisticRegression(C=1.0, max_iter=5000),
    "縮小LDA": lambda: LinearDiscriminantAnalysis(solver="lsqr", shrinkage="auto"),
}
GRID = [(w, b, c) for c in CLASSIFIERS for b in BANDSETS for w in WINDOWS]


# ------------------------------------------------------------------ データ
def load(raw_dir):
    """全被験者の試行を返す。X: (n, 6, 512) [µV], 128 Hz, 4 秒"""
    out = {k: [] for k in ("X", "stim", "mod", "art", "sub")}
    for s in range(1, 16):
        E = sio.loadmat(os.path.join(raw_dir, f"sub-{s:02d}_eeg.mat"))["EEG"]
        lab = E[:, -3:].astype(int)  # 列: モダリティ(1=想像,2=発声), 刺激(1-5 母音, 6-11 単語), アーチファクト(1=なし,2=あり)
        X = E[:, :-3].reshape(-1, 6, 4096)
        out["X"].append(ss.resample_poly(X, 1, 1024 // FS, axis=-1).astype(np.float64))
        out["mod"].append(lab[:, 0]); out["stim"].append(lab[:, 1] - 1); out["art"].append(lab[:, 2] == 2)
        out["sub"].append(np.full(len(E), s))
    return {k: np.concatenate(v) for k, v in out.items()}


# ------------------------------------------------------------------ 特徴量（src/features.js と同じ計算）
def psd(X, win):
    a, b = int(win[0] * FS), int(win[1] * FS)
    f, P = ss.welch(X[..., a:b], fs=FS, nperseg=FS, noverlap=FS // 2, window="hann",
                    detrend="constant", scaling="density", axis=-1)
    return f, P


def band_features(f, P, bands):
    F = [np.log(P[..., (f >= lo) & (f < hi)].mean(-1)) for lo, hi in bands]
    return np.stack(F, -1).reshape(P.shape[0], -1)   # 並び: ch0 の全帯域, ch1 の全帯域, ...


class FeatureCache:
    def __init__(self, X):
        self.psd = {w: psd(X, w) for w in WINDOWS}

    def get(self, idx, cfg):
        w, b, _ = cfg
        f, P = self.psd[w]
        return band_features(f, P[idx], BANDSETS[b])


def make_model(cfg):
    return make_pipeline(StandardScaler(), CLASSIFIERS[cfg[2]]())


# ------------------------------------------------------------------ 入れ子の交差検証
def nested_subject(cache, idx, y, seed=0, score="acc"):
    """1人分。外側5分割の予測と、各分割で選ばれた設定・学習済みモデルを返す"""
    outer = StratifiedKFold(5, shuffle=True, random_state=seed)
    pred = np.zeros(len(idx), int); proba = np.zeros((len(idx), len(np.unique(y)))); fold = np.zeros(len(idx), int)
    folds = []
    scoring = "balanced_accuracy" if score == "bacc" else "accuracy"
    for k, (tr, te) in enumerate(outer.split(idx, y)):
        inner = StratifiedKFold(5, shuffle=True, random_state=seed + 1)
        best, best_s = None, -1
        for cfg in GRID:
            s_ = cross_val_score(make_model(cfg), cache.get(idx[tr], cfg), y[tr], cv=inner, scoring=scoring).mean()
            if s_ > best_s + 1e-12:
                best, best_s = cfg, s_
        m = make_model(best).fit(cache.get(idx[tr], best), y[tr])
        Fte = cache.get(idx[te], best)
        pred[te] = m.predict(Fte); proba[te] = m.predict_proba(Fte); fold[te] = k
        folds.append({"cfg": best, "model": m, "inner": best_s})
    return pred, proba, fold, folds


def run_within(cache, data, mask, y_all, seed=0, score="acc", shuffle_rng=None, min_per_class=8):
    """被験者ごとの入れ子CV。どれかのクラスが min_per_class 試行未満の被験者は外す（内側5分割ができないため）"""
    from joblib import Parallel, delayed
    jobs = []
    for s in range(1, 16):
        idx = np.where(mask & (data["sub"] == s))[0]
        y = y_all[idx].copy()
        if len(idx) == 0 or np.bincount(y).min() < min_per_class or (np.bincount(y) > 0).sum() < len(np.unique(y_all[mask])):
            continue
        if shuffle_rng is not None:
            y = shuffle_rng.permutation(y)
        jobs.append((s, idx, y))
    out = Parallel(n_jobs=-1)(delayed(nested_subject)(cache, idx, y, seed, score) for s, idx, y in jobs)
    return {s: (idx, y) + o for (s, idx, y), o in zip(jobs, out)}


def summarize(res, score="acc"):
    per = {}
    allc = alln = 0
    for s, (idx, y, pred, *_ ) in res.items():
        a = balanced_accuracy_score(y, pred) if score == "bacc" else float((pred == y).mean())
        per[s] = a; allc += int((pred == y).sum()); alln += len(y)
    return per, allc, alln


# ------------------------------------------------------------------ 被験者をまたぐ評価（LOSO）
def loso(cache, data, mask, y_all):
    idx = np.where(mask)[0]; y = y_all[idx]; g = data["sub"][idx]
    feats = {}
    for cfg in {(w, b, None) for w, b, _ in GRID}:
        F = cache.get(idx, cfg)
        for s in np.unique(g):  # 被験者ごとに特徴を標準化（ラベルは使わない）
            k = g == s; F[k] = (F[k] - F[k].mean(0)) / (F[k].std(0) + 1e-12)
        feats[cfg[:2]] = F
    def one(s):
        tr, te = g != s, g == s
        best, best_s = None, -1
        for cfg in GRID:
            F = feats[cfg[:2]]
            s_ = cross_val_score(make_model(cfg), F[tr], y[tr], groups=g[tr], cv=GroupKFold(5)).mean()
            if s_ > best_s + 1e-12:
                best, best_s = cfg, s_
        F = feats[best[:2]]
        return make_model(best).fit(F[tr], y[tr]).predict(F[te])

    from joblib import Parallel, delayed
    subs = np.unique(g)
    pred = np.zeros(len(idx), int)
    for s, p in zip(subs, Parallel(n_jobs=-1)(delayed(one)(s) for s in subs)):
        pred[g == s] = p
    per = {int(s): float((pred[g == s] == y[g == s]).mean()) for s in np.unique(g)}
    return per, int((pred == y).sum()), len(y)


# ------------------------------------------------------------------ ほかに試した方法（参考、入れ子なし）
def baselines(data, mask, y_all):
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.svm import SVC
    from pyriemann.classification import MDM
    from pyriemann.estimation import Covariances
    from pyriemann.tangentspace import TangentSpace
    X = data["X"]
    f, P = psd(X, (0, 4))
    fine = np.log(P[..., (f >= 2) & (f <= 45)]).reshape(len(X), -1)
    sos = ss.butter(4, 8, "low", fs=FS, output="sos")
    erp = ss.sosfiltfilt(sos, X, axis=-1)[..., ::8].reshape(len(X), -1)
    methods = {
        "1Hz刻みスペクトル + ランダムフォレスト": (fine, lambda: RandomForestClassifier(300, random_state=0, n_jobs=-1)),
        "1Hz刻みスペクトル + SVM(RBF)": (fine, lambda: make_pipeline(StandardScaler(), SVC(C=1))),
        "共分散 + リーマン接空間 + ロジスティック回帰": (X, lambda: make_pipeline(Covariances("oas"), TangentSpace(), StandardScaler(), LogisticRegression(C=0.1, max_iter=5000))),
        "共分散 + リーマン最小距離(MDM)": (X, lambda: make_pipeline(Covariances("oas"), MDM())),
        "8Hz以下の波形そのもの(ERP) + 縮小LDA": (erp, lambda: make_pipeline(StandardScaler(), LinearDiscriminantAnalysis(solver="lsqr", shrinkage="auto"))),
    }
    out = {}
    for name, (F, mk) in methods.items():
        accs = []
        for s in range(1, 16):
            idx = np.where(mask & (data["sub"] == s))[0]
            accs.append(cross_val_score(mk(), F[idx], y_all[idx], cv=StratifiedKFold(5, shuffle=True, random_state=0)).mean())
        out[name] = float(np.mean(accs))
        print(f"  {name}: {out[name]:.3f}", flush=True)
    return out


# ------------------------------------------------------------------ ブラウザ用の書き出し
def export_model(fold):
    w, b, c = fold["cfg"]
    pipe = fold["model"]
    sc, clf = pipe[0], pipe[-1]
    return {"win": list(w), "bands": [list(x) for x in BANDSETS[b]], "bandset": b, "clf": c,
            "mean": np.round(sc.mean_, 7).tolist(), "std": np.round(sc.scale_, 7).tolist(),
            "W": np.round(clf.coef_, 7).tolist(), "b": np.round(clf.intercept_, 7).tolist()}


def softmax(z):
    z = z - z.max(-1, keepdims=True); e = np.exp(z); return e / e.sum(-1, keepdims=True)


def quantize(x):
    scale = float(np.abs(x).max()) / 32767.0
    q = np.round(x / scale).astype("<i2")
    return q, scale


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default=os.path.join(HERE, "..", "data", "raw"))
    ap.add_argument("--out", default=os.path.join(HERE, "..", "data"))
    ap.add_argument("--perm", type=int, default=100, help="置換検定の回数")
    ap.add_argument("--demo-per-class", type=int, default=8)
    a = ap.parse_args()
    t0 = time.time()
    data = load(a.raw)
    cache = FeatureCache(data["X"])
    clean = ~data["art"]
    imag_v = clean & (data["mod"] == 1) & (data["stim"] < 5)
    print(f"想像した母音（アーチファクトなし）: {imag_v.sum()} 試行", flush=True)

    # 1) 本番: 被験者内・入れ子CV
    res = run_within(cache, data, imag_v, data["stim"])
    per, K, N = summarize(res)
    bt = stats.binomtest(K, N, 0.2, alternative="greater")
    ci = stats.binomtest(K, N, 0.2).proportion_ci(0.95, method="wilson")  # 信頼区間は両側
    print(f"被験者内: {K}/{N} = {K / N:.3f}  p={bt.pvalue:.3f}  ({time.time() - t0:.0f}s)", flush=True)
    cm = np.zeros((5, 5), int)
    cfg_count = {}
    per_subject = []
    for s, (idx, y, pred, proba, fold, folds) in res.items():
        for t, p in zip(y, pred):
            cm[t, p] += 1
        for fo in folds:
            key = f"{fo['cfg'][2]} / {fo['cfg'][1]} / {fo['cfg'][0][0]:g}–{fo['cfg'][0][1]:g}秒"
            cfg_count[key] = cfg_count.get(key, 0) + 1
        n = len(y); k = int((pred == y).sum())
        per_subject.append({"subject": s, "n": n, "correct": k, "acc": k / n,
                            "p": float(stats.binomtest(k, n, 0.2, alternative="greater").pvalue),
                            "ci": list(stats.binomtest(k, n, 0.2).proportion_ci(0.95, method="wilson"))})

    # 3) 被験者をまたぐ評価
    lper, lk, ln = loso(cache, data, imag_v, data["stim"])
    print(f"被験者間(LOSO): {lk}/{ln} = {lk / ln:.3f}", flush=True)

    # 4) 同じ手順で別の問題を解いて、パイプラインが働くか確かめる
    checks = []
    def check(name, mask, yv, chance, score="acc", note=""):
        r = run_within(cache, data, mask, yv, score=score)
        p_, k_, n_ = summarize(r, score)
        v = float(np.mean(list(p_.values()))) if score == "bacc" else k_ / n_
        checks.append({"name": name, "acc": v, "chance": chance, "metric": "バランス正解率" if score == "bacc" else "正解率",
                       "n": int(n_), "subjects": len(r), "note": note})
        print(f"  {name}: {v:.3f} (偶然 {chance:.2f})", flush=True)
    voc_v = clean & (data["stim"] < 5)
    # 注意: このデータは「想像/発声」「母音/単語」がまとまり（ブロック）ごとに記録されている。
    # そのため次の2つは、課題の違いだけでなく時間による変化も手がかりになりうる（計算が働くかの確認用）。
    # 母音どうしはブロックの中でランダムな順に出るので、本番の母音分類にこの問題はない。
    check("想像したか、声に出したか", voc_v, (data["mod"] == 2).astype(int), 0.5, "bacc", "同じ母音で比べる・記録はブロックごと")
    check("想像した母音か、単語か", clean & (data["mod"] == 1), (data["stim"] >= 5).astype(int), 0.5, "bacc", "母音5種 vs 単語6種・記録はブロックごと")
    check("声に出した母音（5種）", clean & (data["mod"] == 2) & (data["stim"] < 5), data["stim"], 0.2, "acc", "試行が少ない（各母音8試行以上の人だけ）")
    check("想像した単語（6種）", clean & (data["mod"] == 1) & (data["stim"] >= 5), np.clip(data["stim"] - 5, 0, None), 1 / 6, "acc", "")

    # 5) 参考: ほかの方法
    print("ほかの方法（入れ子なし・参考）:", flush=True)
    base = baselines(data, imag_v, data["stim"])

    # 2) 置換検定（いちばん時間がかかるので最後）: ラベルを被験者内でシャッフルして同じ手順を丸ごと回す
    rng = np.random.default_rng(123)
    null = []
    for i in range(a.perm):
        r = run_within(cache, data, imag_v, data["stim"], shuffle_rng=rng)
        _, k, n = summarize(r)
        null.append(k / n)
        if (i + 1) % 10 == 0:
            print(f"  置換 {i + 1}/{a.perm}  ({time.time() - t0:.0f}s)", flush=True)
    p_perm = (1 + sum(v >= K / N for v in null)) / (1 + len(null))

    results = {
        "dataset": {"name": "Open access database of EEG signals recorded during imagined speech",
                    "authors": "G. A. Pressel Coretto, I. E. Gareis, H. L. Rufiner", "year": 2017,
                    "doi": "10.1117/12.2255697", "mirror": "https://doi.org/10.82901/nemar.nm000258",
                    "subjects": 15, "channels": CH, "fs_original": 1024, "fs_used": FS,
                    "trials_used": int(N)},
        "within": {"correct": K, "n": N, "acc": K / N, "ci": list(ci), "p_binom": float(bt.pvalue),
                   "p_perm": p_perm, "null": null, "per_subject": per_subject,
                   "confusion": cm.tolist(), "chosen": cfg_count,
                   "n_significant": sum(p["p"] < 0.05 for p in per_subject)},
        "loso": {"correct": lk, "n": ln, "acc": lk / ln,
                 "ci": list(stats.binomtest(lk, ln, 0.2).proportion_ci(0.95, method="wilson")),
                 "p_binom": float(stats.binomtest(lk, ln, 0.2, alternative="greater").pvalue),
                 "per_subject": lper},
        "checks": checks,
        "baselines": base,
        "grid": {"windows": WINDOWS, "bandsets": BANDSETS, "classifiers": list(CLASSIFIERS)},
    }
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "results.json"), "w") as f:
        json.dump(results, f, ensure_ascii=False, indent=1)

    # 7) ブラウザで動かす分: 被験者ごとに5つのモデル（分割ごと）と、テスト側に回った試行の一部
    demo_rng = np.random.default_rng(7)
    subjects = []
    for s, (idx, y, pred, proba, fold, folds) in res.items():
        pick = []
        for c in range(5):
            cand = np.where(y == c)[0]
            pick += sorted(demo_rng.choice(cand, min(a.demo_per_class, len(cand)), replace=False).tolist())
        pick = sorted(pick)
        trials = []
        for j in pick:
            q, scale = quantize(data["X"][idx[j]])
            # ブラウザと同じく、量子化したあとのデータで確率を計算しておく（テストで照合）
            xq = q.astype(np.float64) * scale
            fo = folds[fold[j]]
            f, P = psd(xq[None], fo["cfg"][0])
            pr = fo["model"].predict_proba(band_features(f, P, BANDSETS[fo["cfg"][1]]))[0]
            trials.append({"label": int(y[j]), "fold": int(fold[j]), "scale": scale,
                           "data": base64.b64encode(q.tobytes()).decode(), "py": np.round(pr, 6).tolist()})
        models = [export_model(fo) for fo in folds]
        # 書き出した重みで predict_proba が再現できることを確認
        for t in trials:
            m = models[t["fold"]]
            xq = np.frombuffer(base64.b64decode(t["data"]), "<i2").reshape(6, -1) * t["scale"]
            f, P = psd(xq[None], tuple(m["win"]))
            z = (band_features(f, P, m["bands"]) - np.array(m["mean"])) / np.array(m["std"])
            assert np.allclose(softmax(z @ np.array(m["W"]).T + np.array(m["b"]))[0], t["py"], atol=1e-4)
        subjects.append({"subject": s, "acc": per[s], "models": models, "trials": trials})
    demo = {"fs": FS, "channels": CH, "vowels": VOWELS, "subjects": subjects}
    with open(os.path.join(a.out, "demo.json"), "w") as f:
        json.dump(demo, f, separators=(",", ":"))
    print(f"書き出し完了 ({time.time() - t0:.0f}s)")


if __name__ == "__main__":
    main()
