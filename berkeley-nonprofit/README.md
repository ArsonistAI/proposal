# Arsonist AI — Berkeley Nonprofit Proposal (GitHub Pages)

This folder is the static site for **https://arsonistai.github.io/berkeley-nonprofit/**.

## Publish to GitHub Pages

1. **Create a new repository** on GitHub named `berkeley-nonprofit` under the **ArsonistAI** organization (or your `arsonistai` user account).
   - Do not add a README, .gitignore, or license.

2. **Push this folder as the repo root:**
   ```bash
   cd berkeley-nonprofit
   git init
   git add .
   git commit -m "Initial Berkeley nonprofit proposal site"
   git remote add origin https://github.com/ArsonistAI/berkeley-nonprofit.git
   git branch -M main
   git push -u origin main
   ```

3. **Enable GitHub Pages:**
   - Repo → **Settings** → **Pages**
   - **Source:** Deploy from a branch
   - **Branch:** main → / (root) → Save

The site will be live at **https://arsonistai.github.io/berkeley-nonprofit/**.
