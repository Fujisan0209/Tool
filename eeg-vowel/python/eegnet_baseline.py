"""参考: 小さな畳み込みネット（EEGNet 型）でも同じ問題を解き、results.json の「ほかに試した方法」に足します。

train.py のあとに実行します（PyTorch が必要。ブラウザのモデルには使いません）。

    python eegnet_baseline.py
"""
import argparse, json, os
import numpy as np
import torch
from torch import nn
from sklearn.model_selection import StratifiedKFold

import train as T

HERE = os.path.dirname(os.path.abspath(__file__))
NAME = "EEGNet 型の畳み込みネット（被験者ごと・波形から直接）"


class EEGNet(nn.Module):
    """Lawhern et al. (2018) の EEGNet を 6ch・128 Hz 用に小さくしたもの"""

    def __init__(self, n_ch=6, n_cls=5, F1=8, D=2, F2=16, drop=0.5):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(1, F1, (1, 64), padding=(0, 32), bias=False), nn.BatchNorm2d(F1),
            nn.Conv2d(F1, F1 * D, (n_ch, 1), groups=F1, bias=False), nn.BatchNorm2d(F1 * D), nn.ELU(),
            nn.AvgPool2d((1, 4)), nn.Dropout(drop),
            nn.Conv2d(F1 * D, F1 * D, (1, 16), padding=(0, 8), groups=F1 * D, bias=False),
            nn.Conv2d(F1 * D, F2, 1, bias=False), nn.BatchNorm2d(F2), nn.ELU(),
            nn.AvgPool2d((1, 8)), nn.Dropout(drop), nn.Flatten())
        with torch.no_grad():
            n = self.net(torch.zeros(1, 1, n_ch, 512)).shape[1]
        self.fc = nn.Linear(n, n_cls)

    def forward(self, x):
        return self.fc(self.net(x))


def fit_predict(Xtr, ytr, Xte, epochs=150, seed=0):
    torch.manual_seed(seed)
    m = EEGNet()
    opt = torch.optim.Adam(m.parameters(), lr=1e-3, weight_decay=1e-3)
    Xtr_t = torch.tensor(Xtr[:, None], dtype=torch.float32); ytr_t = torch.tensor(ytr)
    for _ in range(epochs):
        m.train()
        perm = torch.randperm(len(Xtr_t))
        for i in range(0, len(perm), 32):
            b = perm[i:i + 32]
            opt.zero_grad()
            nn.functional.cross_entropy(m(Xtr_t[b]), ytr_t[b]).backward()
            opt.step()
    m.eval()
    with torch.no_grad():
        return m(torch.tensor(Xte[:, None], dtype=torch.float32)).argmax(1).numpy()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default=os.path.join(HERE, "..", "data", "raw"))
    ap.add_argument("--out", default=os.path.join(HERE, "..", "data"))
    a = ap.parse_args()
    data = T.load(a.raw)
    mask = ~data["art"] & (data["mod"] == 1) & (data["stim"] < 5)
    accs = []
    for s in range(1, 16):
        idx = np.where(mask & (data["sub"] == s))[0]
        X = data["X"][idx]; y = data["stim"][idx]
        X = (X - X.mean(-1, keepdims=True)) / (X.std(axis=(1, 2), keepdims=True) + 1e-9)  # 試行ごとに標準化
        pred = np.zeros(len(y), int)
        for tr, te in StratifiedKFold(5, shuffle=True, random_state=0).split(X, y):
            pred[te] = fit_predict(X[tr], y[tr], X[te])
        accs.append(float((pred == y).mean()))
        print(f"被験者{s}: {accs[-1]:.3f}", flush=True)
    print(f"平均 {np.mean(accs):.3f}")
    path = os.path.join(a.out, "results.json")
    R = json.load(open(path))
    R["baselines"][NAME] = float(np.mean(accs))
    json.dump(R, open(path, "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
