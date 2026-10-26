# Deploy backend Studia lên AWS EC2

## Bản dùng Free Tier (khuyến nghị cho bạn)
- Instance: **t3.micro** (x86, 2 vCPU, 1 GB) hoặc **t4g.micro** (ARM, 1 GB). Chọn loại nào có nhãn *Free tier eligible* trong màn hình Launch; tài khoản mới (sau 07/2025) thường nhận gói credit có thời hạn thay vì 12 tháng miễn phí, nên **xem lại điều kiện thực tế trong Billing › Free tier** và đặt AWS Budgets (vd. 1 USD) để được cảnh báo.
- Ổ đĩa: gp3 **20 GB** (hạn mức miễn phí 30 GB). Chỉ 1 Elastic IP gắn vào instance đang chạy (IPv4 công khai hiện có tính phí nhỏ sau free tier).
- RAM 1 GB rất sát: `setup.sh` tạo swap 2 GB, compose giới hạn container 750 MB. Lần build đầu mất vài phút vì dùng swap; nếu bị `Killed`, chạy lại lệnh build.
- Giảm tải: hạn chế xử lý nhiều PDF lớn cùng lúc (đặt `MAX_PDF_PAGES=300`; `MAX_PDF_MB` mặc định 100 trong `.env`).
- Khi hết free tier, nâng lên `t4g.small` (bảng dưới) mà không cần đổi cấu hình, chỉ tăng `mem_limit` lên 1400m.

## Cấu hình khuyến nghị (trả phí)
| Mục | Chọn | Lý do |
|---|---|---|
| Instance | **t4g.small** (ARM, 2 vCPU, 2 GB) ~ 12 USD/tháng. Rẻ hơn nữa: t4g.micro/t3.micro 1 GB + swap (hợp free tier nếu tài khoản còn được hưởng) | App chủ yếu chờ I/O; burstable là đủ. Bỏ `numpy`/`sklearn` nên RAM nhẹ |
| AMI | Ubuntu 24.04 LTS (đúng kiến trúc arm64 với t4g; Docker image python:3.12-slim đa kiến trúc) | |
| Ổ đĩa | gp3 16–20 GB | image ~0,6 GB, còn chỗ cho log/swap |
| Mạng | **Elastic IP** + Security Group mở 80, 443 (công khai), 22 (chỉ IP của bạn) | |
| Process | 1 worker uvicorn trong Docker, `restart: unless-stopped` | vòng nhắc lịch/xử lý sách chạy trong tiến trình |
| HTTPS | Caddy (tự cấp Let's Encrypt) | không cần ALB |

Không dùng instance C/M lớn: không cải thiện được gì vì tắc nghẽn là Supabase/Gemini chứ không phải CPU.

## Các bước
1. EC2 › Launch instance theo bảng trên, tạo key pair, gán Elastic IP.
2. Trỏ DNS: `api.<domain>` (A record) → Elastic IP.
3. SSH vào máy, chạy:
   ```bash
   git clone <repo của bạn> studia && cd studia
   bash deploy/ec2/setup.sh        # swap + Docker; đăng xuất/đăng nhập lại sau đó
   ```
4. Tạo `backend/.env` trên server (copy từ `backend/.env.example`), đặt: `ENVIRONMENT=production`, `AUTH_REQUIRED=true`, các khoá Supabase/Gemini/SePay,
   `CORS_ORIGINS=https://<frontend>`, `FRONTEND_URL`, `BACKEND_PUBLIC_URL=https://api.<domain>`.
5. Sửa `deploy/ec2/Caddyfile`: thay `api.example.com` bằng domain thật.
6. Chạy:
   ```bash
   cd deploy/ec2 && docker compose up -d --build
   docker compose logs -f api
   ```
7. Kiểm tra `https://api.<domain>/health`. Đặt `NEXT_PUBLIC_API_URL=https://api.<domain>/api/v1` ở frontend, cập nhật webhook SePay.

## Cập nhật phiên bản (thủ công, khi không dùng CI/CD)
```bash
cd ~/studia && git pull && cd deploy/ec2 && docker compose up -d --build
```

## CI/CD (GitHub Actions)
Workflow [backend-deploy.yml](../.github/workflows/backend-deploy.yml): PR chỉ chạy `pytest`; push vào `main` (đổi `backend/**` hoặc `deploy/ec2/**`) chạy test, build image amd64+arm64 đẩy lên GHCR, rồi SSH vào EC2 `pull` image mới, `up -d` và chờ healthcheck (fail job nếu không lên). Build ở CI nên EC2 1 GB không phải build.

Thiết lập một lần:
1. Làm xong các bước ở mục "Các bước" (repo đã clone ở `~/studia`, `backend/.env` đã có, Caddyfile đã sửa domain).
2. Tạo cặp khoá riêng cho CI: `ssh-keygen -t ed25519 -f ci_key -N ""`, thêm `ci_key.pub` vào `~/.ssh/authorized_keys` trên EC2.
3. GitHub › Settings › Secrets and variables › Actions, thêm: `EC2_HOST` (Elastic IP/domain), `EC2_USER` (`ubuntu`), `EC2_SSH_KEY` (nội dung `ci_key`). Tuỳ chọn: tạo Environment `production` có bước duyệt tay.
4. Security Group mở cổng 22 cho runner GitHub (IP thay đổi) hoặc dùng SSM/Tailscale nếu không muốn mở rộng; mở 22 toàn cầu thì bắt buộc dùng khoá, tắt đăng nhập mật khẩu.
5. Nếu repo private, token `GITHUB_TOKEN` của job được dùng để `docker login` GHCR trên server (hết hạn sau job, image đã kéo xong thì không cần nữa).

Rollback: trên EC2 sửa `deploy/ec2/.env` thành `API_IMAGE=ghcr.io/<owner>/<repo>/studia-api:<sha cũ>` rồi `docker compose up -d`.

## Vận hành
- Dữ liệu thật ở Supabase; ổ đĩa EC2 chỉ là fallback. Bật snapshot EBS nếu dùng `data/` cục bộ.
- Đặt AWS Budgets cảnh báo chi phí; CloudWatch alarm CPU credit nếu dùng t-series.
- Thêm UptimeRobot ping `/health`.
