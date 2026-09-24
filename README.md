# UsagiMusic

Một repo chạy 3 bot nhạc Discord dùng chung 1 tiến trình Node.js duy nhất (Single-Process Architecture) kết nối External Lavalink v4:

- Usagi Music 1 (Cung cấp lệnh slash `/play` tập trung)
- Usagi Music 2
- Usagi Music 3

## Kiến trúc siêu tiết kiệm RAM (Tối ưu hóa cho Railway Hobby $5)

- **Single Process**: Cả 3 bot chạy chung trong 1 tiến trình Node.js V8 duy nhất, tiết kiệm ~180MB RAM so với mô hình fork đa tiến trình.
- **External Lavalink Cluster**: Sử dụng các cụm server Lavalink v4 chuyên dụng ngoài (`Serenetia`, `TriniumHost`, `MilloHost`), không chạy máy ảo Java (JVM) nội bộ trong container Railway, tiết kiệm ngay **~300MB RAM**.
- **Alpine Base**: Chạy trên `node:22-alpine` siêu nhẹ, không cài Java/Python/FFmpeg, build chỉ mất ~15 giây.
- **Cache Optimization**: Vứt bỏ triệt để các cache không cần thiết của Discord.js (`MessageManager: 0`, `PresenceManager: 0`...) kèm bộ quét rác (sweepers) tự động giải phóng định kỳ.
- **Tổng RAM tiêu thụ**: Chỉ dao động **~75MB - 95MB** (giảm hơn 75% RAM so với trước).
- **Chi phí Railway**: Chỉ khoảng **~$0.80 - $1.00 / tháng** (tiết kiệm tối đa cho gói Hobby $5).

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
