import type { ReactNode } from "react";
import { cx } from "@/lib/format";

/**
 * The one container in the system. Square corners, hairline border, an
 * optional micro-label header with a rule that runs to the panel edge.
 */
export function Panel({
  label,
  aside,
  children,
  className,
  bodyClassName,
  scroll,
}: {
  label?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  scroll?: boolean;
}) {
  return (
    <section
      className={cx(
        "flex min-h-0 flex-col border border-ink-700 bg-ink-850/70 backdrop-blur-[2px]",
        className,
      )}
    >
      {label && (
        <header className="flex shrink-0 items-center gap-3 border-b border-ink-700 px-3 py-2">
          <span className="label-micro whitespace-nowrap">{label}</span>
          <span className="h-px flex-1 bg-ink-700" />
          {aside}
        </header>
      )}
      <div
        className={cx(
          "min-h-0 flex-1",
          scroll && "scroll-thin overflow-y-auto",
          bodyClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}
