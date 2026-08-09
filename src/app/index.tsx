import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Pilulier</Text>
      <Link href="/developer/datamatrix-scanner" style={styles.link}>
        Ouvrir le scanner DataMatrix (développeur)
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: '600',
  },
  link: {
    marginTop: 24,
  },
});
