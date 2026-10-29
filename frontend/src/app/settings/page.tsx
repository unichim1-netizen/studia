"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { API, apiFetch } from "@/lib/api";
import Link from "next/link";
import { useAccount, clearAccount, formatVnd } from "@/lib/account";
import { DEFAULT_PROFILE, Profile, fetchServerProfile, pushServerProfile } from "@/lib/placement";
import { DEFAULT_PREFS, Prefs, loadPrefs, savePrefs } from "@/lib/prefs";

const SECTIONS = [
  ["ho-so", "Hồ sơ"], ["goi", "Gói của tôi"], ["muc-tieu", "Mục tiêu học"], ["nhac-hoc", "Nhắc học"],
  ["am-thanh", "Âm thanh & giọng đọc"], ["giao-dien", "Giao diện"], ["du-lieu", "Dữ liệu & tài khoản"],
] as const;
const BANDS = [5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0];
const MINUTES = [15, 30, 45, 60];

function Row({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="set-row">
      <div><div className="set-t">{title}</div>{hint && <p className="meta">{hint}</p>}</div>
      <div className="set-ctl">{children}</div>
    </div>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="set-sw" onClick={() => onChange(!on)} />;
}

function Seg<T extends string | number>({ value, options, onChange, label }: {
  value: T; options: [T, string][]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={String(v)} className="seg-btn" type="button" role="radio" aria-checked={v === value} aria-pressed={v === value} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

export default function SettingsPage() {
  const { account, isAdmin } = useAccount();
  const [name, setName] = useState("");
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [status, setStatus] = useState<"saved" | "saving" | "error">("saved");
  const [pw, setPw] = useState("");
  const [pwOpen, setPwOpen] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [msg, setMsg] = useState("");
  const [delOpen, setDelOpen] = useState(false);
  const [delEmail, setDelEmail] = useState("");
  const [delBusy, setDelBusy] = useState(false);
  const [active, setActive] = useState<string>("ho-so");
  const [orders, setOrders] = useState<any[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setPrefs(loadPrefs());
    supabase.auth.getUser().then(({ data }) => setName((data.user?.user_metadata?.full_name as string) || ""));
    fetchServerProfile().then((r) => r.profile && setProfile(r.profile));
    apiFetch("/billing/orders").then(async (r) => setOrders(r.ok ? (await r.json()).orders || [] : [])).catch(() => setOrders([]));
  }, []);

  useEffect(() => {
    const io = new IntersectionObserver((es) => {
      es.forEach((e) => e.isIntersecting && setActive(e.target.id));
    }, { rootMargin: "-30% 0px -60% 0px" });
    SECTIONS.forEach(([id]) => { const el = document.getElementById(id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, []);

  const changeProfile = (patch: Partial<Profile>) => {
    const next = { ...profile, ...patch };
    setProfile(next);
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => setStatus((await pushServerProfile(next)) ? "saved" : "error"), 600);
  };

  const changePrefs = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePrefs(next);
    setStatus("saved");
  };

  const toggleReminder = async (on: boolean) => {
    if (on && "Notification" in window && Notification.permission === "default") {
      const p = await Notification.requestPermission();
      if (p !== "granted") { setMsg("Trình duyệt chưa cho phép thông báo nên không bật được nhắc học."); return; }
    }
    if (on && "Notification" in window && Notification.permission === "denied") {
      setMsg("Thông báo đang bị chặn trong trình duyệt. Hãy cho phép thông báo cho trang này."); return;
    }
    setMsg("");
    changePrefs({ remind: on });
  };

  const saveName = async () => {
    setStatus("saving");
    const { error } = await supabase.auth.updateUser({ data: { full_name: name } });
    setStatus(error ? "error" : "saved");
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.auth.updateUser({ password: pw });
    setPwMsg(error ? { ok: false, text: error.message } : { ok: true, text: "Đã đổi mật khẩu." });
    if (!error) setPw("");
  };

  const download = async (path: string, filename: string) => {
    setMsg("");
    try {
      const res = await apiFetch(`${API}${path}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setMsg(`Không tải được: ${e.message || "lỗi máy chủ"}`);
    }
  };

  const deleteAccount = async () => {
    setDelBusy(true); setMsg("");
    try {
      const res = await apiFetch(`${API}/profile/delete-account`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm_email: delEmail }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || String(res.status));
      clearAccount();
      await supabase.auth.signOut();
      window.location.href = "/welcome";
    } catch (e: any) {
      setMsg(e.message || "Không xoá được tài khoản.");
      setDelBusy(false);
    }
  };

  const quota = account?.quota;
  const quotaTotal = quota ? quota.free + quota.purchased + quota.adjusted : 0;
  const paidOrders = (orders || []).filter((o) => o.status === "paid");
  const pendingOrder = (orders || []).find((o) => o.status === "pending");

  const badge = status === "saving" ? ["st-badge", "Đang lưu…"] : status === "error" ? ["st-badge st-badge-danger", "Chưa lưu được"] : ["st-badge st-badge-success", "✓ Đã lưu"];

  return (
    <div className="wrap stagger" style={{ maxWidth: 980 }}>
      <style>{`
        .set-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(220px,300px);gap:20px;align-items:center;padding:16px 0;border-top:1px solid var(--hairline)}
        .set-row:first-of-type{border-top:0}
        .set-t{font:600 15px/22px var(--font-sans);color:var(--ink)}
        .set-ctl{display:flex;justify-content:flex-end}
        .set-ctl .input{width:100%}
        .set-sw{position:relative;width:44px;height:26px;border-radius:13px;border:0;background:var(--border-control);cursor:pointer;padding:0}
        .set-sw::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:var(--surface);box-shadow:var(--shadow-xs);transition:transform var(--dur-base) var(--ease-spring)}
        .set-sw[aria-checked="true"]{background:var(--brand)}
        .set-sw[aria-checked="true"]::after{transform:translateX(18px)}
        .toc a{display:block;padding:8px 12px;border-radius:var(--radius-sm);color:var(--ink-secondary);text-decoration:none;font:500 14.5px/20px var(--font-sans)}
        .toc a:hover{background:var(--surface-sunken);color:var(--ink)}
        .toc a[aria-current="true"]{background:var(--brand-tint);color:var(--brand);font-weight:600}
        @media (max-width: 900px){ .set-layout{grid-template-columns:minmax(0,1fr)!important} .toc{display:none!important} .set-row{grid-template-columns:minmax(0,1fr)} .set-ctl{justify-content:flex-start} }
      `}</style>

      <header className="page-head">
        <div><h1 className="page-title">Cài đặt</h1><p className="page-sub">Thay đổi được lưu ngay khi bạn chỉnh.</p></div>
        <span className={badge[0]} role="status">{badge[1]}</span>
      </header>
      {msg && <div role="alert" className="st-alert st-alert-danger">{msg}</div>}

      <div className="set-layout" style={{ display: "grid", gridTemplateColumns: "200px minmax(0, 1fr)", gap: 32, alignItems: "start" }}>
        <nav className="toc" aria-label="Mục cài đặt" style={{ position: "sticky", top: 24, display: "flex", flexDirection: "column", gap: 2 }}>
          {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`} aria-current={active === id}>{label}</a>)}
        </nav>

        <div className="stack" style={{ gap: 20 }}>
          <section id="ho-so" className="st-card" aria-labelledby="h1s">
            <h2 id="h1s" className="heading-3" style={{ marginBottom: 8 }}>Hồ sơ</h2>
            <Row title="Tên gọi" hint="Hiện trên lời chào mỗi ngày">
              <input className="input" value={name} aria-label="Tên gọi" onChange={(e) => setName(e.target.value)} onBlur={saveName} />
            </Row>
            <Row title="Email" hint="Dùng để đăng nhập, không đổi được"><span className="ink2">{account?.email || "—"}</span></Row>
            <Row title="Mật khẩu" hint={pwOpen ? undefined : "Nhập mật khẩu mới để thay"}>
              {pwOpen ? (
                <form onSubmit={changePassword} style={{ display: "flex", gap: 8, width: "100%" }}>
                  <input className="input" type="password" minLength={8} required autoComplete="new-password" placeholder="Tối thiểu 8 ký tự" aria-label="Mật khẩu mới" value={pw} onChange={(e) => setPw(e.target.value)} />
                  <button className="st-btn st-btn-primary st-btn-sm" type="submit" disabled={pw.length < 8}>Lưu</button>
                </form>
              ) : (
                <button className="st-btn st-btn-secondary st-btn-sm" type="button" onClick={() => setPwOpen(true)}>Đổi mật khẩu</button>
              )}
            </Row>
            {pwMsg && <p role={pwMsg.ok ? "status" : "alert"} className="meta" style={{ color: pwMsg.ok ? "var(--success)" : "var(--danger)" }}>{pwMsg.text}</p>}
          </section>

          <section id="goi" className="st-card" aria-labelledby="hgs">
            <div className="row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
              <h2 id="hgs" className="heading-3">Gói của tôi</h2>
              <span className={isAdmin ? "st-badge st-badge-accent" : paidOrders.length ? "st-badge st-badge-success" : "st-badge st-badge-brand"}>
                {isAdmin ? "Quản lý" : paidOrders.length ? `Gói ${paidOrders[0].pack_name || "đã mua"}` : "Gói miễn phí"}
              </span>
            </div>
            <Row title="Trạng thái tài khoản" hint={isAdmin ? "Tải sách không giới hạn, quản lý gói và giá ở mục Quản trị" : "Học Thư viện Studia luôn miễn phí"}>
              <span className={account?.status === "locked" ? "st-badge st-badge-danger" : "st-badge st-badge-success"}>{account?.status === "locked" ? "Đã khoá" : "Đang hoạt động"}</span>
            </Row>
            {isAdmin ? (
              <Row title="Lượt upload sách"><b>Không giới hạn</b></Row>
            ) : (
              <>
                <div className="set-quota" style={{ padding: "16px 0", borderTop: "1px solid var(--hairline)" }}>
                  <div className="row" style={{ alignItems: "baseline", gap: 10 }}>
                    <b className="num" style={{ font: "750 40px/1 var(--font-display)", letterSpacing: "-1px" }}>{quota ? quota.remaining : "–"}</b>
                    <span className="ink2">lượt upload sách còn lại</span>
                  </div>
                  {quota && quotaTotal > 0 && <div className="bar" style={{ margin: "10px 0 6px" }}><i style={{ width: `${Math.min(100, Math.round((quota.used / quotaTotal) * 100))}%` }} /></div>}
                  {quota && <p className="meta">{quota.free} miễn phí · {quota.purchased} đã mua{quota.adjusted ? ` · ${quota.adjusted > 0 ? "+" : ""}${quota.adjusted} điều chỉnh` : ""} · {quota.used} đã dùng</p>}
                </div>
                <Row title="Gói đã mua" hint={orders === null ? "Đang tải…" : paidOrders.length ? undefined : "Bạn chưa mua gói nào"}>
                  {paidOrders.length > 0 ? (
                    <div className="stack" style={{ gap: 2, textAlign: "right" }}>
                      {paidOrders.slice(0, 3).map((o) => (
                        <span key={o.id} className="ink2" style={{ fontSize: 14 }}>
                          <b style={{ fontWeight: 600 }}>{o.pack_name}</b> · +{o.books} sách · {formatVnd(o.paid_amount_vnd ?? o.amount_vnd)}
                          {o.paid_at ? ` · ${new Date(o.paid_at).toLocaleDateString("vi-VN")}` : ""}
                        </span>
                      ))}
                    </div>
                  ) : <span className="ink2">—</span>}
                </Row>
                {pendingOrder && (
                  <Row title="Đơn đang chờ thanh toán" hint={`${pendingOrder.pack_name} · ${formatVnd(pendingOrder.amount_vnd)}`}>
                    <Link className="st-btn st-btn-secondary st-btn-sm" href={`/billing/${pendingOrder.id}`}>Tiếp tục thanh toán</Link>
                  </Row>
                )}
              </>
            )}
            <Row title={isAdmin ? "Quản lý gói" : "Mua thêm lượt, xem lịch sử"}>
              <Link className="st-btn st-btn-primary st-btn-sm" href={isAdmin ? "/admin/packs" : "/billing"}>{isAdmin ? "Mở Gói & cài đặt" : "Gói & lượt upload"}</Link>
            </Row>
          </section>

          <section id="muc-tieu" className="st-card" aria-labelledby="h2s">
            <h2 id="h2s" className="heading-3" style={{ marginBottom: 8 }}>Mục tiêu học</h2>
            <Row title="Band mục tiêu" hint="Đổi mục tiêu sẽ tính lại lộ trình">
              <select className="input" aria-label="Band mục tiêu" value={profile.target} onChange={(e) => changeProfile({ target: Number(e.target.value) })}>
                {BANDS.map((b) => <option key={b} value={b}>{b.toFixed(1)}</option>)}
              </select>
            </Row>
            <Row title="Ngày thi">
              <input className="input" type="date" aria-label="Ngày thi" value={profile.examDate} onChange={(e) => changeProfile({ examDate: e.target.value, noExam: !e.target.value })} />
            </Row>
            <Row title="Loại bài thi">
              <Seg label="Loại bài thi" value={profile.kind} options={[["Academic", "Academic"], ["General Training", "General"]]} onChange={(kind) => changeProfile({ kind })} />
            </Row>
            <Row title="Thời gian mỗi ngày">
              <select className="input" aria-label="Thời gian mỗi ngày" value={profile.minutes} onChange={(e) => changeProfile({ minutes: Number(e.target.value) })}>
                {MINUTES.map((m) => <option key={m} value={m}>{m} phút</option>)}
              </select>
            </Row>
          </section>

          <section id="nhac-hoc" className="st-card" aria-labelledby="h3s">
            <h2 id="h3s" className="heading-3" style={{ marginBottom: 8 }}>Nhắc học</h2>
            <Row title="Nhắc học hằng ngày" hint="Thông báo trình duyệt vào giờ bạn chọn, khi Studia đang mở">
              <Switch on={prefs.remind} onChange={toggleReminder} label="Nhắc học hằng ngày" />
            </Row>
            <Row title="Giờ nhắc">
              <input className="input" type="time" aria-label="Giờ nhắc" value={profile.remindAt} onChange={(e) => changeProfile({ remindAt: e.target.value })} />
            </Row>
            <Row title="Nhắc khi sắp mất chuỗi ngày học" hint="Chỉ khi hôm nay bạn chưa học phút nào">
              <Switch on={prefs.remindStreak} onChange={(v) => changePrefs({ remindStreak: v })} label="Nhắc giữ chuỗi" />
            </Row>
            <Row title="Email tổng kết tuần" hint="Lưu lựa chọn; chức năng gửi email sẽ bật sau">
              <Switch on={prefs.weeklyEmail} onChange={(v) => changePrefs({ weeklyEmail: v })} label="Email tổng kết tuần" />
            </Row>
          </section>

          <section id="am-thanh" className="st-card" aria-labelledby="h4s">
            <h2 id="h4s" className="heading-3" style={{ marginBottom: 8 }}>Âm thanh &amp; giọng đọc</h2>
            <Row title="Giọng đọc mặc định" hint="Dùng cho flashcard, từ vựng và luyện phát âm">
              <Seg label="Giọng đọc" value={prefs.voice} options={[["en-GB", "Anh – Anh"], ["en-US", "Anh – Mỹ"]]} onChange={(voice) => changePrefs({ voice })} />
            </Row>
            <Row title="Tốc độ đọc">
              <Seg label="Tốc độ đọc" value={prefs.rate} options={[[0.8, "0.8×"], [1, "1×"], [1.2, "1.2×"]]} onChange={(rate) => changePrefs({ rate })} />
            </Row>
            <Row title="Tự phát âm khi lật thẻ">
              <Switch on={prefs.autoSpeak} onChange={(v) => changePrefs({ autoSpeak: v })} label="Tự phát âm khi lật thẻ" />
            </Row>
          </section>

          <section id="giao-dien" className="st-card" aria-labelledby="h5s">
            <h2 id="h5s" className="heading-3" style={{ marginBottom: 8 }}>Giao diện</h2>
            <Row title="Chế độ màu">
              <Seg label="Chế độ màu" value={prefs.theme} options={[["light", "Sáng"], ["dark", "Tối"], ["system", "Theo máy"]]} onChange={(theme) => changePrefs({ theme })} />
            </Row>
            <Row title="Cỡ chữ bài đọc" hint={<span className="passage-sm" style={{ fontSize: prefs.font === "sm" ? 14 : prefs.font === "lg" ? 19 : 16 }}>The quick brown fox jumps over the lazy dog.</span>}>
              <Seg label="Cỡ chữ" value={prefs.font} options={[["sm", "Nhỏ"], ["md", "Vừa"], ["lg", "Lớn"]]} onChange={(font) => changePrefs({ font })} />
            </Row>
            <Row title="Giảm chuyển động" hint="Tắt hiệu ứng lật thẻ và chuyển cảnh">
              <Switch on={prefs.reduceMotion} onChange={(v) => changePrefs({ reduceMotion: v })} label="Giảm chuyển động" />
            </Row>
          </section>

          <section id="du-lieu" className="st-card" aria-labelledby="h6s">
            <h2 id="h6s" className="heading-3" style={{ marginBottom: 8 }}>Dữ liệu &amp; tài khoản</h2>
            <Row title="Xuất flashcard sang Anki" hint="Tệp .tsv nhập thẳng vào Anki (File › Import)">
              <button className="st-btn st-btn-secondary st-btn-sm" type="button" onClick={() => download("/export/flashcards/anki-all", "studia_flashcards.tsv")}>Tải xuống</button>
            </Row>
            <Row title="Xuất toàn bộ dữ liệu học" hint="Từ vựng, lỗi sai, kết quả thi — dạng JSON">
              <button className="st-btn st-btn-secondary st-btn-sm" type="button" onClick={() => download("/profile/export", "studia_du_lieu.json")}>Tải xuống</button>
            </Row>
            <Row title="Phiên đăng nhập">
              <button className="st-btn st-btn-ghost st-btn-sm" type="button" onClick={() => { clearAccount(); supabase.auth.signOut(); }}>Đăng xuất</button>
            </Row>
            {!isAdmin && (
              <div style={{ marginTop: 16, padding: 16, borderRadius: "var(--radius-md)", border: "1px solid color-mix(in srgb, var(--danger) 30%, transparent)" }}>
                <div className="row" style={{ justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                  <div><div className="set-t" style={{ color: "var(--danger)" }}>Xoá tài khoản</div>
                    <p className="meta">Xoá vĩnh viễn sách, lịch học và lịch sử thi. Không khôi phục được.</p></div>
                  {!delOpen && <button className="st-btn st-btn-secondary st-btn-sm" type="button" style={{ color: "var(--danger)", borderColor: "color-mix(in srgb, var(--danger) 40%, transparent)" }} onClick={() => setDelOpen(true)}>Xoá tài khoản</button>}
                </div>
                {delOpen && (
                  <div className="stack" style={{ marginTop: 14, gap: 10 }}>
                    <label className="field"><span className="field-label">Nhập email <b>{account?.email}</b> để xác nhận</span>
                      <input className="input" type="email" autoComplete="off" value={delEmail} onChange={(e) => setDelEmail(e.target.value)} /></label>
                    <div className="row" style={{ gap: 8 }}>
                      <button className="st-btn st-btn-ghost st-btn-sm" type="button" onClick={() => { setDelOpen(false); setDelEmail(""); }}>Huỷ</button>
                      <button className="st-btn st-btn-sm" type="button" disabled={delBusy || delEmail.trim().toLowerCase() !== (account?.email || "").toLowerCase()}
                        style={{ background: "var(--danger)", color: "var(--on-brand)" }} onClick={deleteAccount}>
                        {delBusy ? "Đang xoá…" : "Xoá vĩnh viễn"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
