
/**
 * @description Debounce a function
 * @param callback function to be debounced
 * @param wait ms to wait before calling the callback
 * @returns void
 * @example
 * debounce(() => {console.log("debounced")}, 1000);
 */
export const debounce = (callback: (...args: unknown[]) => void, wait: number) => {
    let timeoutId: number | undefined = undefined;
    return (...args: unknown[]) => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        callback(...args);
      }, wait);
    };
  };
  