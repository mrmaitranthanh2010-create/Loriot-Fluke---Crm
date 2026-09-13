# Quy trình an toàn và khôi phục Loriot CRM

Tài liệu này dùng khi CRM không mở được, đăng nhập lỗi hoặc dữ liệu bị sửa/xóa nhầm. Không xóa dữ liệu hay khôi phục D1 khi chưa xác định đúng nguyên nhân.

## Các lớp bảo vệ đang dùng

1. `CRM_AUTH_USERNAME` và `CRM_AUTH_PASSWORD` chỉ được lưu trong Cloudflare Variables and Secrets. Cấu hình xuất bản bật `keep_vars`, vì vậy bản build mới không được ghi đè hoặc xóa hai giá trị này.
2. D1 Time Travel của Cloudflare là lớp phục hồi theo thời điểm gần nhất.
3. Mỗi ngày lúc 01:20 theo giờ Việt Nam, Worker tạo một bản sao nén của các bảng nghiệp vụ CRM và lưu trong R2 tại `system/backups/d1/`.
4. Hệ thống giữ 90 bản sao hằng ngày gần nhất. Tệp `system/backups/d1/latest.json` ghi nhận lần sao lưu thành công mới nhất.
5. Đường dẫn `/__health` kiểm tra Worker, D1 và tình trạng bản sao mà không công khai dữ liệu CRM.

## Khi CRM không đăng nhập được

1. Mở `https://loriot-fluke-crm.mr-maitranthanh2010.workers.dev/__health`.
2. Nếu trạng thái là `ok`, dữ liệu và ứng dụng vẫn hoạt động; kiểm tra lại hai biến bảo mật trong Cloudflare.
3. Trong Cloudflare Worker Settings, đặt lại `CRM_AUTH_USERNAME` hoặc `CRM_AUTH_PASSWORD` dưới dạng Secret. Không đưa giá trị thật vào mã nguồn, GitHub hay tin nhắn.
4. Đổi mật khẩu sẽ tự kết thúc các phiên đăng nhập cũ. Không cần sửa hoặc khôi phục D1.

## Khi bản xuất bản mới gây lỗi

1. Mở Cloudflare Worker > Deployments.
2. Chọn phiên bản hoạt động gần nhất trước sự cố và Rollback.
3. Kiểm tra `/__health`, sau đó mới đăng nhập CRM.

Rollback ứng dụng không làm thay đổi dữ liệu D1.

## Khi dữ liệu bị sửa hoặc xóa nhầm

1. Dừng thao tác cập nhật trên CRM.
2. Ghi lại thời điểm gần nhất dữ liệu còn đúng.
3. Ưu tiên dùng D1 Time Travel để khôi phục đúng thời điểm đó.
4. Nếu cần bản cũ hơn phạm vi Time Travel, dùng bản sao nén trong R2.
5. Luôn thử bản sao trên một cơ sở dữ liệu tạm trước khi thay thế dữ liệu đang chạy.

Bản sao R2 là lớp dự phòng độc lập theo từng bảng nghiệp vụ, không phải ảnh chụp giao dịch tức thời. Vì vậy, D1 Time Travel vẫn là lựa chọn ưu tiên khi còn trong thời hạn phục hồi.

## Kiểm tra định kỳ

- `/__health` phải trả về `status: ok`.
- `backup` chuyển từ `pending` sang `ok` sau lần sao lưu đầu tiên.
- `lastBackupAt` không được cũ quá 26 giờ.
- Workers Logs phải không có lỗi `daily D1 backup failed`.
