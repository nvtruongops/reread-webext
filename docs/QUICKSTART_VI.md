# Hướng Dẫn Sử Dụng Nhanh Từ Điển Anh - Việt Cho re/read

Thư mục này chứa bộ từ điển Anh - Việt tổng hợp chuẩn định dạng **StarDict** trích xuất từ dự án [redphx/tudien](https://github.com/redphx/tudien) (phiên bản 20260411) với hơn **235,000 từ vựng**.

---

## 1. Các Tệp Trong Thư Mục

* `tudien-stardict-en-vi-20260411.ifo`: Tệp thông tin mô tả từ điển.
* `tudien-stardict-en-vi-20260411.idx`: Tệp chỉ mục từ vựng (4.75 MB).
* `tudien-stardict-en-vi-20260411.dict.dz`: Tệp dữ liệu định nghĩa nén dictzip (15.1 MB).

---

## 2. Trải Nghiệm Cài Đặt (Zero-Setup Tự Động)

Extension đã được tích hợp cơ chế **tự động cài đặt sẵn (Zero-Setup Out-of-the-box)**:
1. Khi tải extension vào trình duyệt (`chrome://extensions` hoặc `about:debugging`):
   * Hệ thống tự động thiết lập cặp ngôn ngữ mặc định: **Tiếng Anh → Tiếng Việt**.
   * Bộ mô hình dịch AI **en-vi** và **vi-en** (Bergamot / Marian NMT từ Mozilla) được tự động giải nén và nạp vào cơ sở dữ liệu IndexedDB.
   * Toàn bộ từ điển StarDict Anh - Việt (hơn 235.000 từ) được tự động lập chỉ mục và nạp vào IndexedDB.
2. Bạn **không cần phải thao tác thủ công** bất kỳ bước cài đặt nào. Sau khi cài extension, bạn có thể bắt đầu đọc và tra cứu ngay lập tức!

---

## 3. Cách Sử Dụng Khi Đọc Báo / Tài Liệu

* **Dịch & Tra từ trên trang web**: Bôi đen bất kỳ từ hoặc cụm từ tiếng Anh nào trên web:
  * Bảng bong bóng sẽ hiển thị **bản dịch câu của AI** ở trên.
  * Phía dưới hiển thị **định nghĩa chi tiết từ điển Anh - Việt** (phiên âm IPA, cấp độ CEFR, các từ loại danh từ/động từ, câu ví dụ).
* **Tra từ nhanh không cần mở trang web**:
  * Nhấp vào biểu tượng **re/read** trên thanh công cụ trình duyệt (Popup).
  * Gõ từ cần tra vào ô tìm kiếm và nhấn Enter để xem ngay định nghĩa offline.
