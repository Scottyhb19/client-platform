import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg)]">
      <SignIn
        appearance={{
          variables: {
            colorPrimary: "#0A5540",
            fontFamily: "Barlow, sans-serif",
          },
        }}
      />
    </div>
  );
}
