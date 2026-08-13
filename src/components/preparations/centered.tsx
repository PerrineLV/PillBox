import { Stack } from 'expo-router';
import { Text, View } from 'react-native';

import { styles } from './styles';

export function Centered({
  text,
  children,
}: {
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.centered}>
      <Stack.Screen
        options={{ headerShown: true, title: 'Préparer mon pilulier' }}
      />
      <Text>{text}</Text>
      {children}
    </View>
  );
}
