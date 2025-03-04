import VoipSDK from '../api/voip-sdk';

// Khởi tạo SDK
let voiceSDK: VoipSDK | null = null;

/**
 * Hàm cập nhật giao diện khi trạng thái thay đổi
 * @param status Trạng thái mới của agent
 * @param reason Lý do thay đổi trạng thái (tùy chọn)
 */
function updateStatusUI(status: string, reason?: string): void {
  const currentStatusElement = document.getElementById('currentStatus');
  if (currentStatusElement) {
    const statusText = reason ? `${status} (${reason})` : status;
    currentStatusElement.textContent = statusText;

    // Cập nhật trạng thái active cho item được chọn
    document.querySelectorAll('.status-item').forEach((item: Element) => {
      const statusItem = item as HTMLElement;
      if (statusItem.dataset.status === status) {
        statusItem.classList.add('active');
      } else {
        statusItem.classList.remove('active');
      }
    });
  }
}

/**
 * Thiết lập delegate cho VoiceSDK
 */
function setupDelegate(): any {
  return {
    onStatus: (status: string, reason?: string) => {
      console.log(`Agent status changed to: ${status}${reason ? `, Reason: ${reason}` : 'No reason provided'}`);
      updateStatusUI(status, reason);
    },
  };
}

/**
 * Hàm khởi tạo SDK và thiết lập các sự kiện
 * @param agentId ID của agent
 */
function initializeSDK(agentId: string): void {
  // Khởi tạo SDK với thông tin agent
  VoipSDK.init(
    {
      el: 'app',
      appId: agentId,
      appName: 'voiceuat.metechvn.com',
      gateways: ['ws://101.99.20.58:7080'],
      secretKey: 'your-secret-key',
      nssUrl: 'http://0.0.0.0:3000/ws',
      delegate: setupDelegate(),
    },
    instance => {
      voiceSDK = instance;

      // Đăng nhập
      if (voiceSDK) {
        voiceSDK
          .login({ extension: agentId, password: 'Abcd@54321' })
          .then(result => {
            if (result.success) {
              console.log('Đăng nhập thành công');
              const statusSection = document.getElementById('statusSection');
              if (statusSection) {
                statusSection.style.display = 'block';
              }

              // Lấy trạng thái hiện tại
              if (voiceSDK) {
                const statusResult = voiceSDK.getAgentStatus();
                if (statusResult.success && statusResult.status) {
                  updateStatusUI(statusResult.status, statusResult.reason);
                } else {
                  updateStatusUI('OFFLINE');
                }
              }
            } else {
              console.error('Lỗi đăng nhập:', result.error);
              alert('Đăng nhập thất bại: ' + result.error);
            }
          })
          .catch(error => {
            console.error('Lỗi đăng nhập:', error);
            alert('Đăng nhập thất bại: ' + error.message);
          });
      }
    },
  );
}

/**
 * Thay đổi trạng thái của agent
 */
async function setAgentStatus(status: string, reason?: string): Promise<void> {
  if (!voiceSDK) {
    alert('Vui lòng đăng nhập trước');
    return;
  }

  try {
    console.log('Đang thay đổi trạng thái thành:', status, reason ? `Lý do: ${reason}` : '');

    const result = await voiceSDK.setAgentStatus({ status, reason });

    if (result.success) {
      console.log('Agent status updated successfully');
    } else {
      console.error('Failed to update agent status:', result.error);
      alert('Không thể thay đổi trạng thái: ' + result.error);
    }
  } catch (error: any) {
    console.error('Error changing status:', error);
    alert('Không thể thay đổi trạng thái: ' + error.message);
  }
}

// Thiết lập sự kiện khi trang được tải
document.addEventListener('DOMContentLoaded', () => {
  // Hiển thị thông tin về NSS
  const infoElement = document.createElement('div');
  infoElement.style.marginTop = '20px';
  infoElement.style.padding = '10px';
  infoElement.style.backgroundColor = '#f8f8f8';
  infoElement.style.border = '1px solid #ddd';
  infoElement.style.borderRadius = '4px';
  infoElement.innerHTML = `
    <h3>Thông tin NSS</h3>
    <p>NSS đang chạy tại: <code>http://0.0.0.0:3000</code></p>
    <p>WebSocket path: <code>ws://0.0.0.0:3000/ws</code></p>
  `;
  document.body.appendChild(infoElement);

  // Xử lý sự kiện đăng nhập
  const loginButton = document.getElementById('loginBtn');
  if (loginButton) {
    loginButton.addEventListener('click', () => {
      const agentIdInput = document.getElementById('agentId') as HTMLInputElement;
      const agentId = agentIdInput.value.trim();

      if (!agentId) {
        alert('Vui lòng nhập Agent ID');
        return;
      }

      initializeSDK(agentId);
    });
  }

  // Xử lý sự kiện khi người dùng chọn trạng thái mới
  document.querySelectorAll('.status-item').forEach((item: Element) => {
    const statusItem = item as HTMLElement;
    statusItem.addEventListener('click', () => {
      if (!voiceSDK) {
        alert('Vui lòng đăng nhập trước');
        return;
      }

      const newStatus = statusItem.dataset.status;
      if (!newStatus) return;

      // Có thể thêm lý do nếu cần
      const reason = prompt('Nhập lý do thay đổi trạng thái (tùy chọn):');
      setAgentStatus(newStatus, reason || undefined);
    });
  });
});

// Export các hàm cần thiết
export { initializeSDK, updateStatusUI };
