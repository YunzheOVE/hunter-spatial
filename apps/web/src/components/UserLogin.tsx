"use client";

import { useState, type FormEvent } from "react";
import { isCampusEmail } from "@/lib/accountPolicy.mjs";
import type { SessionUser } from "@/lib/uploads";

const inputClass = "mt-1 w-full rounded-xl border border-[#dedfe3] bg-white/90 px-3 py-2.5 text-sm text-[#2f3137]";
const primaryClass = "rounded-xl bg-[#5b238a] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#4b1d72] disabled:opacity-50";
const secondaryClass = "rounded-xl border border-[#5b238a]/30 bg-white/70 px-3 py-2 text-sm font-semibold text-[#5b238a] disabled:opacity-50";

export function UserLogin({ onSignIn }: { onSignIn: (user: SessionUser) => void }) {
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!isCampusEmail(String(form.get("email") ?? "").trim())) {
      setError("Use your @login.cuny.edu email address.");
      return;
    }
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/auth/${authMode}`, {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(form)),
      });
      const body = await response.json().catch(() => ({ error: "Unable to complete the request. Please try again." }));
      if (!response.ok) throw new Error(body.error ?? "Please try again.");
      onSignIn(body.user);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Please try again."); }
    finally { setBusy(false); }
  }

  return <>
    <div className="flex gap-2">
      <button type="button" className={secondaryClass} aria-pressed={authMode === "sign-in"} onClick={() => { setAuthMode("sign-in"); setError(""); }}>Sign in</button>
      <button type="button" className={secondaryClass} aria-pressed={authMode === "sign-up"} onClick={() => { setAuthMode("sign-up"); setError(""); }}>Sign up</button>
    </div>
    <form key={authMode} onSubmit={authenticate} className="space-y-3">
      <p className="text-xs text-[#555861]">{authMode === "sign-up" ? "Create an account to upload panoramas." : "Sign in to upload and view your submissions."}</p>
      {authMode === "sign-up" ? <label className="block">Name<input className={inputClass} name="name" autoComplete="name" required maxLength={50} /></label> : null}
      <label className="block">Email<input className={inputClass} name="email" type="email" autoComplete="email" placeholder="name@login.cuny.edu" required maxLength={100} /></label>
      <p className="text-xs text-[#555861]">Use your @login.cuny.edu address. Reviewers use the same sign-in form.</p>
      <label className="block">Password<input className={inputClass} name="password" type="password" autoComplete={authMode === "sign-up" ? "new-password" : "current-password"} required minLength={8} maxLength={100} /><span className="mt-1 block text-xs text-[#555861]">8–100 characters.</span></label>
      <button className={`${primaryClass} w-full`} disabled={busy}>{busy ? "Please wait…" : authMode === "sign-up" ? "Create account" : "Sign in to upload"}</button>
    </form>
    {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs leading-5 text-[#b3261e]">{error}</p> : null}
  </>;
}
