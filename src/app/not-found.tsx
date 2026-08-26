import Link from "next/link";

export default function IckeFunnen() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-3xl font-bold">Sidan hittades inte</h1>
      <p className="mt-3 text-muted">
        Sidan du letade efter finns inte längre, eller så har adressen ändrats.
      </p>
      <Link href="/" className="knapp-primar mt-6">
        Till startsidan
      </Link>
    </div>
  );
}
