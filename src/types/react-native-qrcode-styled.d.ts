declare module 'react-native-qrcode-styled' {
  import type { ComponentType } from 'react';
  import type { ViewStyle } from 'react-native';

  export interface QRCodeStyledProps {
    data: string;
    style?: ViewStyle;
    pieceSize?: number;
    color?: string;
    [key: string]: unknown;
  }

  const QRCodeStyled: ComponentType<QRCodeStyledProps>;
  export default QRCodeStyled;
}
