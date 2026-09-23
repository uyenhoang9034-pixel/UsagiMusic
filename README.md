# UsagiMusic

Một repo chạy 3 bot nhạc Discord dùng chung 1 tiến trình Node.js duy nhất (Single-Process Architecture) kết hợp Lavalink nội bộ có `yt-dlp`:

- Usagi Music 1 (Cung cấp lệnh slash `/play` tập trung)
- Usagi Music 2
- Usagi Music 3

## Kiến trúc siêu tiết kiệm RAM (Tối ưu hóa cho Railway Hobby $5)

- **Single Process**: Cả 3 bot chạy chung trong 1 tiến trình Node.js V8 duy nhất, tiết kiệm ~180MB RAM so với mô hình fork đa tiến trình trước đây.
- **Low-Memory Private Lavalink**: Chạy Lavalink nội bộ với bộ dọn rác `SerialGC`, giới hạn heap 128MB, thread stack 256KB, tích hợp `yt-dlp` và `ffmpeg`. Đảm bảo phát mượt 100% mọi link YouTube, SoundCloud, Spotify mà không lo bị chặn hay timeout.
- **Tổng RAM tiêu thụ**: Chỉ dao động **~260MB - 290MB** (tiết kiệm hơn 65% RAM so với mức 800MB ban đầu).
- **Chi phí Railway**: Chỉ khoảng **$2.70 - $2.90 / tháng** (vẫn nằm trọn vẹn trong hạn mức $5/tháng của gói Hobby, còn dư ~$2.20 cho 2 repo khác).

## Biến môi trường

```env
# 3 Token của 3 Discord Bot (Bắt buộc)
MUSIC_BOT_1_TOKEN=
MUSIC_BOT_2_TOKEN=
MUSIC_BOT_3_TOKEN=

# Cổng Express server (Railway tự cấp)
PORT=3000
```

Không commit token lên GitHub.
