import { invoke } from "@tauri-apps/api/core";

import type { SigninComplete, SigninStatus } from "../types";

function getSigninStatus() {
  return invoke<SigninStatus>("desktop_signin_status");
}

function beginSignin() {
  return invoke<SigninComplete>("desktop_signin_begin");
}

function signOut() {
  return invoke<void>("desktop_sign_out");
}

export { beginSignin, getSigninStatus, signOut };
