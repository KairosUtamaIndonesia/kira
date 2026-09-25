# Configure Kira's shell executable

Kira uses Pi's Bash command tool for Kira's terminal commands. It detects a suitable shell automatically on Windows, macOS, and Linux.

If you prefer another Bash-compatible executable, or Kira's terminal commands cannot start the detected one:

1. Open **Settings → Shell**.
2. Choose **Browse** and select the executable to use for Bash commands.
3. Select **Test shell**. Kira runs a harmless command to confirm the executable starts and returns output.
4. Select **Save path**.

The preference is saved on this device. It applies to the next terminal command in every open chat; a command already running is not interrupted. To return to Pi's automatic detection, select **Use automatic detection**.

This changes the executable used by the Bash command tool. It does not switch Kira's command tool to a different shell family such as PowerShell.

It does not change your login shell. Within Kira's Bash commands, `$SHELL` matches the executable selected here; your terminal's login shell remains unchanged.
