import { Image } from 'react-native';
import { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, SafeAreaView, ActivityIndicator, KeyboardAvoidingView, Platform
} from 'react-native';
import { supabase } from '../lib/supabase';

export default function AuthScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);

  const handleAuth = async () => {
    if (!email || !password) {
      alert('Remplis tous les champs !');
      return;
    }
    setLoading(true);
    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) alert(error.message);
      } else {
        if (!username) { alert('Choisis un pseudo !'); setLoading(false); return; }
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) { alert(error.message); setLoading(false); return; }
        if (data.user) {
          await supabase.from('profiles').insert({
            id: data.user.id,
            username: username,
          });
        }
      }
    } catch (e) {
      alert('Erreur : ' + e.message);
    }
    setLoading(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.inner}>

        <Image source={require('../assets/logo.png')} style={styles.logoImg} />
        <Text style={styles.subtitle}>
          {isLogin ? 'Connecte-toi' : 'Crée ton compte'}
        </Text>

        {!isLogin && (
          <TextInput
            style={styles.input}
            placeholder="Pseudo"
            placeholderTextColor="#555"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
          />
        )}

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#555"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <TextInput
          style={styles.input}
          placeholder="Mot de passe"
          placeholderTextColor="#555"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity style={styles.btn} onPress={handleAuth} disabled={loading}>
          {loading
            ? <ActivityIndicator color="#3a0d1e" />
            : <Text style={styles.btnText}>{isLogin ? 'Se connecter' : "S'inscrire"}</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setIsLogin(!isLogin)} style={styles.switchBtn}>
          <Text style={styles.switchText}>
            {isLogin ? "Pas encore de compte ? S'inscrire" : 'Déjà un compte ? Se connecter'}
          </Text>
        </TouchableOpacity>

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  logoImg: { width: 140, height: 140, alignSelf: 'center', marginBottom: 8, borderRadius: 24 },
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  inner:     { flex: 1, padding: 30, justifyContent: 'center' },
  logo:      { fontSize: 42, fontWeight: '800', color: '#ED93B1', textAlign: 'center', marginBottom: 8 },
  subtitle:  { fontSize: 16, color: '#555', textAlign: 'center', marginBottom: 40 },

  input: {
    backgroundColor: '#1a1a1a', borderRadius: 12, padding: 16,
    color: '#fff', fontSize: 15, marginBottom: 14, borderWidth: 1, borderColor: '#2a2a2a'
  },

  btn:     { backgroundColor: '#ED93B1', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 8 },
  btnText: { color: '#3a0d1e', fontWeight: '700', fontSize: 16 },

  switchBtn:  { marginTop: 20, alignItems: 'center' },
  switchText: { color: '#555', fontSize: 13 },

  logoSmall: { width: 40, height: 40, borderRadius: 8 },
});