import Link from "next/link";
import Mascot, { type Mood } from "@/components/mascot/Mascot";

type Action = { label: string; href?: string; onClick?: () => void };

interface EmptyStateProps {
  title: string;
  description?: string;
  /** Các bước gợi ý để người dùng biết bắt đầu từ đâu (đánh số 1, 2, 3). */
  steps?: { title: string; desc?: string; href?: string }[];
  primary?: Action;
  secondary?: Action;
  /** Nhỏ gọn hơn, dùng bên trong một thẻ khác. */
  compact?: boolean;
  /** Tâm trạng của Coal trên trang trống (mặc định: vẫy chào). */
  mood?: Mood;
}

function ActionButton({ action, kind }: { action: Action; kind: "st-btn st-btn-primary" | "st-btn st-btn-secondary" }) {
  if (action.href) {
    return <Link href={action.href} className={kind}>{action.label}</Link>;
  }
  return <button type="button" className={kind} onClick={action.onClick}>{action.label}</button>;
}

export default function EmptyState({ title, description, steps, primary, secondary, compact, mood = "hello" }: EmptyStateProps) {
  return (
    <div
      className={compact ? undefined : "st-card st-enter"}
      style={{ padding: compact ? "24px 16px" : "48px 32px", textAlign: "center" }}
    >
      {!compact && <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}><Mascot mood={mood} size={110} /></div>}
      <h2 style={{ fontSize: compact ? "1.05rem" : "1.4rem", marginBottom: 8 }}>{title}</h2>
      {description && (
        <p style={{
          color: "var(--text-secondary)", maxWidth: 440, margin: "0 auto",
          marginBottom: steps || primary ? 24 : 0, lineHeight: 1.6,
          fontSize: compact ? "0.875rem" : "1rem",
        }}>
          {description}
        </p>
      )}

      {steps && steps.length > 0 && (
        <ol style={{
          listStyle: "none", display: "grid", gap: 10, maxWidth: 440, margin: "0 auto 24px",
          textAlign: "left", counterReset: "step",
        }}>
          {steps.map((s, i) => {
            const body = (
              <>
                <span style={{
                  width: 24, height: 24, flexShrink: 0, borderRadius: "var(--radius-full)",
                  background: "var(--brand-tint)", color: "var(--brand)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "0.75rem", fontWeight: 700,
                }}>
                  {i + 1}
                </span>
                <span>
                  <span style={{ display: "block", fontWeight: 600, fontSize: "0.9rem", color: "var(--text-primary)" }}>{s.title}</span>
                  {s.desc && (
                    <span style={{ display: "block", fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 2 }}>{s.desc}</span>
                  )}
                </span>
              </>
            );
            const style: React.CSSProperties = {
              display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 12px",
              borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)",
              background: "var(--bg-card)", textDecoration: "none", color: "inherit",
              transition: "border-color var(--dur-fast), transform var(--dur-fast) var(--ease-out)",
            };
            return (
              <li key={i}>
                {s.href ? <Link href={s.href} style={style}>{body}</Link> : <div style={style}>{body}</div>}
              </li>
            );
          })}
        </ol>
      )}

      {(primary || secondary) && (
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          {primary && <ActionButton action={primary} kind="st-btn st-btn-primary" />}
          {secondary && <ActionButton action={secondary} kind="st-btn st-btn-secondary" />}
        </div>
      )}
    </div>
  );
}
