# Voice SDK

## Các thay đổi đã thực hiện

1. **Đổi tên class từ `VoipSDK` thành `VoiceSDK`**

   - Tạo file mới `src/api/voice-sdk.ts` dựa trên `src/api/voip-sdk.ts`
   - Cập nhật tất cả các tham chiếu trong code

2. **Cập nhật tên callback**

   - Thêm `statusChanged` vào `StatusDelegate` trong `src/api/types/status.ts`
   - Giữ lại `onStatus` để đảm bảo tương thích ngược
   - Cập nhật `StatusManager` để sử dụng cả hai callback

3. **Thêm các phương thức mới**

   - `mute()`: Tắt tiếng cuộc gọi hiện tại
   - `unmute()`: Bật tiếng cuộc gọi hiện tại
   - `hold()`: Giữ cuộc gọi hiện tại
   - `unhold()`: Tiếp tục cuộc gọi đang giữ
   - `transfer(target: string)`: Chuyển cuộc gọi đến số khác

4. **Cập nhật CallHandler**

   - Thêm các phương thức `muteCall()`, `unmuteCall()`, `holdCall()`, `unholdCall()` và `transferCall()`
   - Các phương thức này sử dụng các API của SIP.js để thực hiện các chức năng tương ứng

5. **Cập nhật file index.html**
   - Cập nhật import từ `VoipSDK` thành `VoiceSDK`
   - Cập nhật các tham chiếu trong code

## Cách sử dụng

```typescript
// Khởi tạo SDK
VoiceSDK.init(config, instance => {
  console.log('SDK đã được khởi tạo thành công');
});

// Đăng nhập
const loginResult = await VoiceSDK.login({
  extension: '1001',
  username: 'User 1001',
  password: 'password',
});

// Thực hiện cuộc gọi
const callResult = await VoiceSDK.makeCall('1002');

// Tắt/bật tiếng
await VoiceSDK.mute();
await VoiceSDK.unmute();

// Giữ/tiếp tục cuộc gọi
await VoiceSDK.hold();
await VoiceSDK.unhold();

// Chuyển cuộc gọi
await VoiceSDK.transfer('1003');

// Kết thúc cuộc gọi
await VoiceSDK.endCall();

// Thiết lập trạng thái
await VoiceSDK.setAgentStatus({
  status: 'AVAILABLE',
  reason: 'Ready to take calls',
});

// Lấy trạng thái hiện tại
const statusResult = VoiceSDK.getAgentStatus();
```
