import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { errorMessage } from "./api";
import { disablePush, enablePush, pushStatus, type PushStatus } from "./push";

/** Trạng thái và thao tác bật/tắt thông báo đẩy cho màn hình Cài đặt và thẻ mời ở tab Bạn bè. */
export function usePush() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    pushStatus().then(setStatus).catch(() => setStatus("unsupported"));
  }, []);

  useEffect(() => {
    refresh();
    // Quay lại app sau khi bật quyền trong Cài đặt của điện thoại thì cập nhật ngay
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") refresh(); });
    return () => sub.remove();
  }, [refresh]);

  const enable = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setStatus(await enablePush());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const disable = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await disablePush();
      setStatus("off");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [busy]);

  return { status, busy, error, enable, disable, refresh };
}
