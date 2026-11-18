# MyNewsHub
Top-5 headlines per channel (News + Sports), newest first, auto-refresh every 30 min.
Breaking stories are shown in bold red. Channels can be added/deleted in the app (⚙).
Add a channel by typing a website (e.g. cnn.com) or a direct RSS feed URL.

## Build the APK
1. Push this folder to a GitHub repo (branch `main`).
2. On expo.dev create a project, then run once locally: `npm i -g eas-cli && eas login && eas init`
   (this writes the project ID into app.json — commit it).
3. On expo.dev create an access token; in GitHub: Settings > Secrets > Actions > add `EXPO_TOKEN`.
4. GitHub > Actions > "Build Android APK" > Run workflow.
5. Download the APK from your build page on expo.dev and install it on your phone.
