import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";

export const metadata = { title: "Entrar" };

export default async function LoginPage() {
  const session = await auth();
  // Só considera "logado" quando a identidade foi resolvida (session.user.id),
  // evitando loop com sessões órfãs (usuário removido / cookie antigo).
  if (session?.user?.id) redirect("/");

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-10 px-6">
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-sm">
          {/* sino */}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-8 w-8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Daily Chores</h1>
        <p className="max-w-xs text-center text-sm text-zinc-500 dark:text-zinc-400">
          Rotinas diárias com alarmes que seguem o seu ritmo.
        </p>
      </div>

      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/" });
        }}
      >
        <button
          type="submit"
          className="flex h-12 min-w-[240px] items-center justify-center gap-3 rounded-2xl border border-zinc-200 bg-white px-6 text-sm font-medium shadow-sm transition active:scale-[0.98] dark:border-zinc-700 dark:bg-zinc-800"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
            <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.6-.2-2.3H12v4.5h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.7 2.9c2.2-2.1 3.7-5.1 3.7-8.9z" />
            <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.8-2.9c-1 .7-2.4 1.2-4.2 1.2-3.2 0-6-2.1-7-5.1l-4 3.1C3 21.3 7.2 24 12 24z" />
            <path fill="#FBBC05" d="M5 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3l-4-3.1C.4 8.2 0 10 0 12s.4 3.8 1 5.4l4-3.1z" />
            <path fill="#EA4335" d="M12 4.7c1.8 0 3 .8 3.7 1.4l3.3-3.2C17 1.1 15.2 0 12 0 7.2 0 3 2.7 1 6.6l4 3.1c1-3 3.8-5 7-5z" />
          </svg>
          Entrar com Google
        </button>
      </form>
    </div>
  );
}
