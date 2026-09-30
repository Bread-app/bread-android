import { StyleSheet } from 'react-native';
import { BottomTabNavigationOptions } from '@react-navigation/bottom-tabs';

export const appTabScreenOptions: BottomTabNavigationOptions = {
  headerShown: false,
  tabBarShowLabel: false,
  tabBarActiveTintColor: '#000000',
  tabBarInactiveTintColor: '#9ca3af',
  tabBarIconStyle: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 0,
  },
  tabBarItemStyle: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 0,
  },
  tabBarStyle: {
    borderTopWidth: 0,
    backgroundColor: 'transparent',
    height: 80,
    paddingTop: 0,
    paddingBottom: 32,
    elevation: 0,
    shadowOpacity: 0,
  },
};
