"""公開データ（Pressel Coretto et al. 2017, NEMAR nm000258）をダウンロードします。

元の配布ファイル（被験者ごとの .mat, 合計 約1.8GB）を NEMAR の公開 S3 から取得し、
NEMAR が記録している SHA-256 と照合します。

    python fetch_data.py            # ./data/raw/ に保存
    python fetch_data.py --out DIR
"""
import argparse, hashlib, json, os, sys, urllib.request

REPO = "https://raw.githubusercontent.com/nemarDatasets/nm000258/main"
S3 = "https://nemar.s3.us-east-2.amazonaws.com/nm000258/objects"


def get(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "data", "raw"))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    prov = json.loads(get(f"{REPO}/sourcedata/sourcedata_provenance.json"))
    for f in prov["files"]:
        dst = os.path.join(a.out, os.path.basename(f["file"]))
        if os.path.exists(dst) and sha256(dst) == f["sha256"]:
            print("OK (既にあります)", dst)
            continue
        # git-annex のキー（SHA256E-s<size>--<hash>.mat）がそのまま S3 のファイル名
        key = f"SHA256E-s{f['bytes']}--{f['sha256']}.mat"
        print(f"ダウンロード中 {os.path.basename(dst)} ({f['bytes'] / 1e6:.0f} MB)", flush=True)
        urllib.request.urlretrieve(f"{S3}/{key}", dst)
        if sha256(dst) != f["sha256"]:
            sys.exit(f"SHA-256 が一致しません: {dst}")
    print("完了:", os.path.abspath(a.out))


if __name__ == "__main__":
    main()
