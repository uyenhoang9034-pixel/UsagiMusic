# UsagiMusic

Một repo chạy 3 bot nhạc Discord dùng chung 1 tiến trình Node.js duy nhất (Single-Process Architecture):

- Usagi Music 1 (Cung cấp lệnh slash `/play` tập trung)
- Usagi Music 2
- Usagi Music 3

## Kiến trúc siêu tiết kiệm RAM (Tối ưu hóa cho Railway Hobby $5)

- **Single Process**: Cả 3 bot chạy chung trong 1 tiến trình Node.js V8 duy nhất, tiết kiệm ~180MB RAM so với mô hình fork đa tiến trình trước đây.
- **External Lavalink**: Không chạy Java JVM nội bộ trên container Railway, tiết kiệm ~400MB RAM. Tổng RAM cả service chỉ ~90MB - 120MB (chỉ tốn ~$1/tháng trên Railway).
- **Cache Optimization**: Vứt bỏ triệt để các cache không cần thiết của Discord.js (`MessageManager: 0`, `PresenceManager: 0`...).

## Biến môi trường

```env
# 3 Token của 3 Discord Bot (Bắt buộc)
MUSIC_BOT_1_TOKEN=
MUSIC_BOT_2_TOKEN=
MUSIC_BOT_3_TOKEN=

# Cổng Express server (Railway tự cấp)
PORT=3000

# Cấu hình Lavalink Node tùy chỉnh (Tùy chọn - nếu không set sẽ dùng từ lavalink/nodes.json)
# Ví dụ kết nối Lavalink riêng từ HuggingFace hoặc Render:
# LAVALINK_HOST=your-lavalink-space.hf.space
# LAVALINK_PORT=443
# LAVALINK_PASSWORD=youshallnotpass
# LAVALINK_SECURE=true
```

Không commit token lên GitHub.
