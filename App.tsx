import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { RootStackParamList } from "./types";

import StartScreen from "./StartScreen";
import TermsScreen from "./TermsScreen";
import MapScreen from "./MapScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Start">
        <Stack.Screen 
          name="Start" 
          component={StartScreen} 
          options={{ headerShown: false }}
        />
        <Stack.Screen 
          name="Terms" 
          component={TermsScreen} 
          options={{ headerShown: false }}
        />
        <Stack.Screen 
          name="MapScreen" 
          component={MapScreen} 
          options={{ headerShown: false }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
