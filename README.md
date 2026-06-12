# Koko GPS App

場所に別れの5秒動画を預けるプロトタイプです。

## Vercel Deploy

1. この `koko-gps-app` フォルダをGitHubリポジトリに入れる
2. VercelでそのリポジトリをImport
3. Framework Presetは `Other`
4. Build Commandは `npm run build`
5. Output Directoryは `dist`
6. Deploy

VercelではHTTPSで配信されるため、ブラウザのカメラ、マイク、位置情報APIが動作できます。

## Local

```bash
npm install
npm run dev
```

## Notes

- 通常URL `/` は実際のブラウザ位置情報を使います。
- `?nearby=1` は通知状態を確認するためのデモモードです。
- 背景地図は無料のCARTO/OSMベースマップを使っています。APIキーは不要です。
- 撮影動画はこのプロトタイプではブラウザ内のIndexedDBに保存されます。
- 住所名は現在プロトタイプ用の表示です。実運用で現在地から住所を出すには、逆ジオコーディングAPIを追加してください。
