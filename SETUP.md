# Setting up the birthday surprise

This takes about 20 minutes. You need a Google account and a GitHub account. You don't need any coding experience: you'll copy, paste and click.

Before you start, have these ready:

- **The deadline**: the last date people can fill it in, e.g. 5 December 2026, 11:59 pm.
- **A secret key**: 12 random letters and numbers, e.g. `q7Rk2mZp9XcL`. Make up your own, or use a password generator. Only people with the link that contains this key can send answers.

---

## 1. Make the Google Sheet and the photos folder

1. Go to [sheets.google.com](https://sheets.google.com) and create a **blank spreadsheet**. Name it anything, e.g. "Birthday surprise".
2. Go to [drive.google.com](https://drive.google.com) and click **New → New folder**. Name it e.g. "Birthday surprise photos".
3. Open the folder. Look at the address bar: it ends in something like `.../folders/1AbCdEfGhIjKlMnOpQrStUvWxYz`. Copy the long part after `folders/`. That is the **folder ID**. Keep it in a note.

Keep both private. Don't share the Sheet or the folder with anyone.

## 2. Add the script to the Sheet

1. In the Sheet, click **Extensions → Apps Script**. A new tab opens with a file called `Code.gs`.
2. Delete everything in that file.
3. Open [`apps-script/Code.gs`](apps-script/Code.gs) from this repo, copy all of it, and paste it into the editor.
4. Click the **Save** icon (the floppy disk).

## 3. Add the three settings

1. In the Apps Script tab, click the **gear icon (Project Settings)** on the left.
2. Scroll down to **Script Properties** and click **Add script property**. Add these three, one at a time:

   | Property | Value |
   |---|---|
   | `ACCESS_KEY` | your 12-character secret key |
   | `PHOTOS_FOLDER_ID` | the folder ID from step 1 |
   | `DEADLINE_ISO` | the deadline in this format: `2026-12-05T23:59:00+05:30` |

3. Click **Save script properties**.

While you're on this page, check that **"Enable Chrome V8 runtime support"** is ticked (it is by default).

## 4. Turn the script into a web app

1. Click the blue **Deploy** button (top right) → **New deployment**.
2. Click the gear next to "Select type" and choose **Web app**.
3. Fill in:
   - Description: anything, e.g. `v1`
   - **Execute as: Me**
   - **Who has access: Anyone**
4. Click **Deploy**.
5. Google asks for permission. Click **Authorize access**, pick your account. You'll see "Google hasn't verified this app": that's expected, because it's your own script. Click **Advanced → Go to (project name) (unsafe) → Allow**. The script needs this to write to your Sheet and your Drive folder, and nothing else.
6. Copy the **Web app URL**. It ends in `/exec`. Keep it in your note.

To check it works, open that URL in a new tab. You should see `{"ok":true}`.

## 5. Fill in `js/config.js`

Open [`js/config.js`](js/config.js) and replace the three `TODO-OWNER` values:

```js
  DEADLINE_ISO: "2026-12-05T23:59:00+05:30",
  DEADLINE_LABEL: "5 December",
  ENDPOINT_URL: "https://script.google.com/macros/s/XXXXXXXX/exec",
```

`DEADLINE_ISO` must be the same as the Script Property. `DEADLINE_LABEL` is what people see on the welcome screen.

**Never put the secret key in this file.** The repo is public.

## 6. Put the site on GitHub Pages

1. Commit and push everything to the `main` branch on GitHub. (If you're editing on github.com, just click **Commit changes**.)
2. On GitHub, open the repo → **Settings → Pages**.
3. Under **Build and deployment**: Source **Deploy from a branch**, Branch **main**, folder **/ (root)**. Click **Save**.
4. Wait a minute or two, then refresh the page. It shows your site address, something like `https://<your-username>.github.io/<repo-name>/`.

## 7. Do a test run

1. Open your site address with the key and test mode added:
   `https://<your-username>.github.io/<repo-name>/?k=YOUR_KEY&test=1`
   You should see a small red **TEST** badge in the corner.
2. Fill in the form, add at least one photo (try a big phone photo), and submit.
3. Check the Sheet: there's a **Responses** tab with your row, and `is_test` is `TRUE`. There's a **Photos** tab with your photo.
4. Check the Drive folder: there's a subfolder named `<your name>_<6 characters>` with your photo in it.
5. Try it on your phone too: open the link from a WhatsApp chat and from an Instagram DM, so you test the in-app browsers.

Test rows stay in the Sheet. When you look at the answers later, filter the `is_test` column to `FALSE`.

## 8. Share the link

Share this link (**without** `&test=1`):

```
https://<your-username>.github.io/<repo-name>/?k=YOUR_KEY
```

If someone gets "This link is incomplete", they've got a link without the key. Send them the full one again.

---

## Good to know

- **If you change `Code.gs` later**, you must deploy a new version or the old code keeps running: **Deploy → Manage deployments → pencil icon (Edit) → Version: New version → Deploy**. The `/exec` URL stays the same.
- **To change the deadline**, update both the `DEADLINE_ISO` Script Property and `js/config.js`, then push.
- **After the deadline**, the site shows "This surprise is now closed" and the script refuses anything new.
- **Nobody can read answers from the site.** The script only ever writes; the only number it gives back is how many people have finished.
- **After the prizes are paid**, delete the `funny_upi` column from the Responses tab.
- **Rows with `completed` = FALSE** are people who started but didn't finish. Their answers so far are still there.
