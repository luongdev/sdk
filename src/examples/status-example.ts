import { VoipSDK } from '../api/voip-sdk';

// Khởi tạo SDK
let sdk: VoipSDK | null = null;

/**
 * Hàm cập nhật giao diện khi trạng thái thay đổi
 * @param status Trạng thái mới của agent
 * @param reason Lý do thay đổi trạng thái (tùy chọn)
 */
function updateStatusUI(status: string, reason?: string): void {
  console.log(`Updating UI with status: ${status}, reason: ${reason || 'N/A'}`);

  // Bỏ chọn tất cả các nút
  document.querySelectorAll('.status-item').forEach(btn => {
    btn.classList.remove('active');
  });

  // Đánh dấu nút trạng thái hiện tại
  const statusBtn = document.querySelector(`.status-item[data-status="${status}"]`);
  if (statusBtn) {
    statusBtn.classList.add('active');
    console.log(`Activated status button for: ${status}`);
  } else {
    console.warn(`Status button not found for: ${status}`);
  }

  // Hiển thị trạng thái hiện tại
  const statusElement = document.getElementById('currentStatus');
  if (statusElement) {
    statusElement.textContent = status + (reason ? ` (${reason})` : '');
    console.log(`Updated status text to: ${statusElement.textContent}`);
  } else {
    console.warn('Status element not found');
  }
}

/**
 * Hàm khởi tạo SDK và thiết lập các sự kiện
 */
function initializeSDK() {
  console.log('Initializing SDK...');

  // Hiển thị phần đổi trạng thái ngay lập tức (để test)
  const statusSection = document.getElementById('statusSection');
  if (statusSection) {
    statusSection.style.display = 'block';
    console.log('Status section is now visible (before SDK init)');
  } else {
    console.error('Status section element not found (before SDK init)!');
  }

  // Khởi tạo SDK với cấu hình hiện tại
  VoipSDK.init(
    {
      el: 'app',
      appId: 'agent123',
      appName: 'voiceuat.metechvn.com',
      gateways: ['ws://101.99.20.58:7080'],
      secretKey: 'your-secret-key',
      nssUrl: 'ws://0.0.0.0:3000/ws',
      delegate: {
        onStatus: (status: string, reason?: string) => {
          console.log(`Status changed to: ${status}${reason ? `, reason: ${reason}` : ''}`);
          updateStatusUI(status, reason);
        },
      },
    },
    instance => {
      sdk = instance;
      console.log('SDK initialized successfully');

      // Đăng nhập sau khi khởi tạo
      sdk
        .login({ extension: '10000', password: 'Abcd@54321' })
        .then(result => {
          if (result.success) {
            console.log('Login successful - showing status section');

            // Hiển thị phần đổi trạng thái sau khi đăng nhập thành công
            const statusSection = document.getElementById('statusSection');
            if (statusSection) {
              statusSection.style.display = 'block';
              console.log('Status section is now visible');
            } else {
              console.error('Status section element not found!');
              // Kiểm tra DOM
              console.log('Document body:', document.body.innerHTML);
            }

            try {
              // Lấy trạng thái hiện tại
              if (sdk) {
                console.log('Getting current agent status');
                const currentStatus = sdk.getAgentStatus();
                console.log('Current status result:', currentStatus);
                if (currentStatus.success && currentStatus.status) {
                  updateStatusUI(currentStatus.status, currentStatus.reason);
                }
              }
            } catch (error) {
              console.error('Error getting current status:', error);
            }
          } else {
            console.error('Login failed:', result.error);
          }
        })
        .catch(error => {
          console.error('Login error:', error);
        });
    },
  );
}

/**
 * Thay đổi trạng thái của agent
 */
function setAgentStatus(status: string, reason?: string) {
  if (!sdk) {
    console.error('SDK not initialized');
    return;
  }

  console.log(`Changing status to: ${status}${reason ? `, reason: ${reason}` : ''}`);

  // Sử dụng phương thức changeStatus với Promise
  sdk
    .changeStatus(status, reason)
    .then(result => {
      if (result.success) {
        console.log('Status changed successfully:', result);
      } else {
        console.error('Failed to change status:', result.error);
        alert(`Failed to change status: ${result.error}`);
      }
    })
    .catch(error => {
      console.error('Error changing status:', error);
      alert(`Error changing status: ${error.message}`);
    });
}

// Thiết lập sự kiện khi trang được tải
window.addEventListener('DOMContentLoaded', () => {
  console.log('DOM fully loaded');

  // Kiểm tra các phần tử DOM
  const statusSection = document.getElementById('statusSection');
  console.log('Status section found:', !!statusSection);

  const statusItems = document.querySelectorAll('.status-item');
  console.log('Status items found:', statusItems.length);

  const loginButton = document.getElementById('loginBtn');
  console.log('Login button found:', !!loginButton);

  // Khởi tạo SDK
  initializeSDK();

  // Thêm sự kiện cho các nút trạng thái
  document.querySelectorAll('.status-item').forEach(btn => {
    btn.addEventListener('click', event => {
      const target = event.currentTarget as HTMLElement;
      const status = target.dataset.status;
      const reason = target.dataset.reason;

      if (status) {
        setAgentStatus(status, reason);
      }
    });
  });

  // Thêm sự kiện cho nút đăng nhập
  if (loginButton) {
    loginButton.addEventListener('click', () => {
      initializeSDK();
    });
  }

  // Thêm sự kiện khi trang đóng để dọn dẹp tài nguyên
  window.addEventListener('beforeunload', () => {
    if (sdk) {
      console.log('Disposing SDK resources before page unload');
      sdk.dispose();
      sdk = null;
    }
  });
});

// Export các hàm cần thiết
export { initializeSDK, updateStatusUI };
