# EnvStash

**EnvStash** is a secure, per-project environment variable and runbook manager integrated directly into the VS Code sidebar. 

Store all your sensitive credentials safely using your system's native keychain (via VS Code's `SecretStorage` API) and organize your launch procedures into custom, executable runbooks.

---

## 🚀 Key Features

*   **🔒 Built-In Security**: Credentials and environment variables are securely encrypted and stored inside your operating system's native keychain (such as Windows Credential Manager, macOS Keychain Access, or GNOME Keyring) utilizing VS Code's `SecretStorage` API.
*   **📂 Multi-Project Support**: Manage separate env files and setup instructions for different microservices or codebases with ease.
*   **🛠️ Executable Runbooks**: Create custom runbooks consisting of sequential stages (e.g. "Seed Database", "Start Dev Server") and execute their commands directly in the VS Code terminal in one click.
*   **📂 Collapsible Stages**: Keep your view clean. Shrink or expand individual runbook stages as needed.
*   **⚡ Bulk Import/Export**: Instantly import raw `.env` copy blocks or backup/restore entire projects to secure JSON files.
*   **🔍 Search & Filter**: Instantly search for specific variables by key or value as your credentials list grows.

---

## 🛠️ How to Use

### 1. Variables Management
- Under the **Variables** tab, click **+ Add variable** at the bottom to register new credentials, or toggle the eye icon to reveal secrets securely.
- Copy any environment variables in a single click with the copy button (`export KEY=value`).
- Search through keys or values in real-time using the search input at the top.

### 2. Import Tab
- Paste raw env blocks (like `DB_HOST=localhost`) directly to parse and bulk-import variables.

### 3. Runbook Executor
- Create stages, add CLI commands inside each stage, and use the terminal icon next to a command to execute it directly inside your active VS Code terminal instance.

---

## ⚙️ Requirements

No external dependencies or software requirements. EnvStash runs fully offline and securely on your local system.

---

## 📦 Build & Installation

### 1. Build & Package locally
To package the extension into a `.vsix` file:
1. Open your terminal at the repository root and navigate to the `extension/` directory:
   ```bash
   cd extension
   ```
2. Install the necessary development dependencies:
   ```bash
   npm install
   ```
3. Compile the TypeScript sources and package the extension:
   ```bash
   npx @vscode/vsce package --allow-missing-repository
   ```

This will generate a file named `envstash-1.0.2.vsix` inside the `extension/` folder.

### 2. Install inside VS Code
- Open VS Code.
- Go to the **Extensions View** (`Ctrl+Shift+X` or `Cmd+Shift+X`).
- Click the three-dot menu `...` at the top right of the Extensions view header.
- Select **Install from VSIX...** and choose the generated `envstash-1.0.2.vsix` file.

---

## 📄 License

This extension is licensed under the MIT License.
