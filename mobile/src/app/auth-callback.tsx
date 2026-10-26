import { Redirect } from "expo-router";
import * as WebBrowser from "expo-web-browser";

// Android có thể đưa app tới địa chỉ này sau khi đăng nhập Google; web dùng nó để đóng cửa sổ đăng nhập.
WebBrowser.maybeCompleteAuthSession();

/** Trang trung gian: về trang chủ, đã đăng nhập thì vào Hôm nay, chưa thì tự về màn hình đăng nhập. */
export default function AuthCallback() {
  return <Redirect href="/" />;
}
