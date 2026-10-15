# COURT — テニス部ランキング

テニス部の部員・大会・試合結果を管理するWebアプリです。GitHub Pagesで画面を公開し、Supabaseを設定すると部員・大会データを複数端末間で共有します。

## 開発

Node.js 20以降を使用します。

```bash
npm ci
npm run dev
```

本番ビルドの確認：

```bash
npm run build
npm run preview
```

## Supabase共有の設定

1. Supabaseでプロジェクトを作成します。
2. SQL Editorで [`supabase/schema.sql`](./supabase/schema.sql) の内容を実行します。
3. SupabaseのProject URLとpublishable key（旧anon key）を使い、プロジェクト直下の `.env.local` を作成します。

   ```dotenv
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-publishable-or-anon-key
   ```

4. `npm run dev` で起動し、接続表示が「Supabaseで部員と大会データを共有中です」になることを確認します。
5. Supabaseのテーブルが空の場合、最初に接続したブラウザの既存localStorageデータが共有データとして初期登録されます。移行したいデータがある端末で、他の部員がアクセスする前に一度起動してください。共有テーブルがすでに存在する場合はクラウド側が優先されます。

`.env.local` はGit管理対象外です。`VITE_SUPABASE_ANON_KEY` はブラウザーへ配信される公開キーです。Supabaseのservice role keyは絶対に設定・公開しないでください。

## GitHub Pagesへの公開

1. GitHubにリポジトリを作成し、このプロジェクトを `main` ブランチへpushします。
2. GitHubリポジトリの **Settings → Secrets and variables → Actions → Variables** に以下を登録します。
   - `VITE_SUPABASE_URL`: Supabase Project URL
   - `VITE_SUPABASE_ANON_KEY`: Supabase publishable key（旧anon key）
3. **Settings → Pages → Build and deployment → Source** を **GitHub Actions** に設定します。
4. `main` へのpush、またはActionsの **Deploy to GitHub Pages → Run workflow** でデプロイします。

GitHub Actionsは `.github/workflows/deploy.yml` でビルドと公開を行います。SupabaseのURL/keyをGitHub Actions Variablesにも設定しない場合、公開サイトはlocalStorageのみで動作します。

## 公開アクセスについて

現在はログインなしの共有設定です。Supabaseのanon keyは公開情報で、RLSポリシーも全員に読み書きを許可しています。そのため、**GitHub PagesのURLを知っている人は部員以外でも部員・大会・試合・ポイントのデータを閲覧・変更できます**。現在の管理者PINは画面上だけの確認であり、データベースのアクセス制限にはなりません。実データを公開してよい場合に限って利用してください。

この構成はベータ用で、ユーザー別権限、監査ログ、自動バックアップ、同じレコードを複数人が同時編集した場合の競合解決はありません。Supabaseのバックアップを有効にし、重要なデータは別途定期的にエクスポートしてください。
