import { View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '../src/context/AuthContext';
import { colors } from '../src/theme';

export default function Index() {
  const { isAuthenticated, isLoading } = useAuth();

  // Show empty screen while loading (layout handles splash)
  if (isLoading) {
    return <View style={{ flex: 1, backgroundColor: '#000000' }} />;
  }

  if (isAuthenticated) {
    return <Redirect href="/(main)/chat" />;
  }

  return <Redirect href="/auth" />;
}
