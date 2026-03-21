import { Platform, Text } from 'react-native';
import Animated from 'react-native-reanimated';

export function HelloWave() {
  const baseStyle = { fontSize: 28, lineHeight: 32, marginTop: -6 };
  if (Platform.OS === 'web') {
    return <Text style={baseStyle}>👋</Text>;
  }
  return (
    <Animated.Text
      style={{
        ...baseStyle,
        animationName: {
          '50%': { transform: [{ rotate: '25deg' }] },
        },
        animationIterationCount: 4,
        animationDuration: '300ms',
      }}>
      👋
    </Animated.Text>
  );
}
