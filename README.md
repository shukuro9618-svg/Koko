# Koko GPS App

場所に別れの5秒動画を預けるWeb/PWA版です。

Supabaseを設定すると、動画と場所情報をクラウドに保存します。未設定のままでも、これまで通りブラウザ内のIndexedDB保存で動きます。

## Vercel Deploy

1. この `koko-gps-app` フォルダをGitHubリポジトリに入れる
2. VercelでそのリポジトリをImport
3. Framework Presetは `Other`
4. Build Commandは `npm run build`
5. Output Directoryは `dist`
6. Environment VariablesにSupabase設定を入れる
7. Deploy

VercelではHTTPSで配信されるため、ブラウザのカメラ、マイク、位置情報APIが動作できます。

### Vercel Environment Variables

```text
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_SUPABASE_BUCKET=farewell-videos
```

`VITE_SUPABASE_BUCKET` は省略すると `farewell-videos` になります。

## Supabase Setup

1. Supabaseで新しいProjectを作成
2. Authentication > Sign In / Providers > Anonymous sign-ins を有効化
3. SQL Editorで `supabase-schema.sql` を実行
4. Project Settings > API から Project URL と anon public key をVercelへ設定

この構成では、保存した動画はSupabase AuthのユーザーIDに紐づきます。初期版は匿名Authなので、同じブラウザ/同じ端末では継続して見られます。機種変更や複数端末同期まで正式に扱う場合は、次の段階でApple/Googleログインを追加してください。

## Local

```bash
npm install
npm run dev
```

## Notes

- 通常URL `/` は実際のブラウザ位置情報を使います。
- `?nearby=1` は通知状態を確認するためのデモモードです。
- `?backup=1` はこの端末の保存データを書き出し/読み込みする保険用の画面を表示します。
- 背景地図は無料のCARTO/OSMベースマップを使っています。APIキーは不要です。
- Supabase未設定時、撮影動画はブラウザ内のIndexedDBに保存されます。
- GPSで取得した緯度経度から無料の逆ジオコーディングAPIで住所を表示します。取得できない場合は座標表示にフォールバックします。
