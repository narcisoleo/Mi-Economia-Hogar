import { LoginForm } from "@/components/login-form";

export default function Page() {
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-[#e7ebf0] px-4 py-10 text-slate-900">
      <div className="w-full max-w-md">
        <LoginForm />
      </div>
    </main>
  );
}
