import { Quiz } from "@/components/Quiz";
import { SITE_NAME } from "@/lib/site";

export default function Home() {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <p className="text-xs font-bold tracking-wider text-accent">エンジニア向け</p>
        <h1 className="text-2xl leading-snug font-bold">{SITE_NAME}</h1>
        <p className="text-sm leading-relaxed text-muted">
          今いる現場がどのくらい健全か、20問で数値化します。
        </p>
      </header>
      <Quiz />
    </div>
  );
}
