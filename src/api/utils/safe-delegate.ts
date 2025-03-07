/**
 * Utility để bảo vệ việc gọi delegate, đảm bảo SDK vẫn hoạt động ngay cả khi delegate gặp lỗi
 */

/**
 * Gọi một hàm delegate một cách an toàn, bắt và ghi log lỗi nếu có
 * @param fn Hàm delegate cần gọi
 * @param args Các tham số cần truyền vào hàm
 * @param context Tên ngữ cảnh để ghi log
 * @returns Kết quả của hàm hoặc undefined nếu có lỗi
 */
export function safeCall<T extends (...args: any[]) => any>(
  fn: T | undefined,
  args: Parameters<T>,
  context: string,
): ReturnType<T> | undefined {
  if (!fn) return undefined;

  try {
    return fn(...args) as ReturnType<T>;
  } catch (error) {
    console.error(`Error in ${context} delegate:`, error);
    return undefined;
  }
}

/**
 * Gọi một hàm delegate bất đồng bộ một cách an toàn, bắt và ghi log lỗi nếu có
 * @param fn Hàm delegate bất đồng bộ cần gọi
 * @param args Các tham số cần truyền vào hàm
 * @param context Tên ngữ cảnh để ghi log
 * @returns Promise với kết quả của hàm hoặc undefined nếu có lỗi
 */
export async function safeCallAsync<T extends (...args: any[]) => Promise<any>>(
  fn: T | undefined,
  args: Parameters<T>,
  context: string,
): Promise<Awaited<ReturnType<T>> | undefined> {
  if (!fn) return undefined;

  try {
    return (await fn(...args)) as Awaited<ReturnType<T>>;
  } catch (error) {
    console.error(`Error in async ${context} delegate:`, error);
    return undefined;
  }
}

/**
 * Tạo một phiên bản an toàn của CallDelegate
 * @param delegate CallDelegate gốc
 * @returns CallDelegate an toàn
 */
export function createSafeCallDelegate(delegate: any): any {
  if (!delegate) return undefined;

  const safeDelegate: Record<string, any> = {};

  // Tạo các phương thức an toàn cho tất cả các thuộc tính của delegate
  Object.entries(delegate).forEach(([key, value]) => {
    if (typeof value === 'function') {
      // Nếu là hàm bất đồng bộ (có thể nhận biết qua constructor.name hoặc kiểm tra Promise)
      if (value.constructor.name === 'AsyncFunction' || value.toString().includes('async')) {
        safeDelegate[key] = async (...args: any[]) => await safeCallAsync(value as any, args, `${key}`);
      } else {
        safeDelegate[key] = (...args: any[]) => safeCall(value as any, args, `${key}`);
      }
    } else if (typeof value === 'object' && value !== null) {
      // Xử lý các đối tượng lồng nhau (như rtc)
      safeDelegate[key] = createSafeCallDelegate(value);
    } else {
      // Giữ nguyên các giá trị không phải hàm
      safeDelegate[key] = value;
    }
  });

  return safeDelegate;
}
