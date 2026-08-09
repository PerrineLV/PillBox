import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Pilulier</Text>
      <Link href="/preparations/new" style={styles.primaryLink}>
        Préparer mon pilulier
      </Link>
      <Link href="/preparations/history" style={styles.link}>
        Historique des préparations
      </Link>
      <Link href="/treatments" style={styles.link}>
        Mes traitements
      </Link>
      <Link href="/inventory" style={styles.link}>
        Mon stock de boîtes
      </Link>
      <Link href="/medications/search" style={styles.link}>
        Rechercher un médicament
      </Link>
      <Link href="/settings" style={styles.link}>
        Réglages
      </Link>
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
  primaryLink: {
    backgroundColor: '#0F6F70',
    borderRadius: 8,
    color: '#fff',
    fontWeight: '700',
    marginTop: 24,
    overflow: 'hidden',
    padding: 14,
  },
});
