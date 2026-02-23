/**
 * Type declarations for ffmpeg-kit-react-native-full (same API as ffmpeg-kit-react-native).
 * Package is installed from GitHub: RebootMotion/ffmpeg-kit-react-native.
 * For the "full" native variant: set ffmpegKitPackage = "full" in android/build.gradle
 * and add the full subspec in ios/Podfile.
 */
declare module 'ffmpeg-kit-react-native-full' {
  export class FFmpegKit {
    static execute(command: string): Promise<FFmpegSession>;
  }
  export interface FFmpegSession {
    getReturnCode(): Promise<ReturnCode>;
  }
  export class ReturnCode {
    static isSuccess(returnCode: ReturnCode | null | undefined): boolean;
    static isCancel(returnCode: ReturnCode | null | undefined): boolean;
  }
  export class FFmpegKitConfig {
    static clearSessions(): Promise<void>;
  }
}
