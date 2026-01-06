window.SUPABASE_URL = "https://anbovljwbvljfhlydsxo.supabase.co";
window.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFuYm92bGp3YnZsamZobHlkc3hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjczNjc0MzUsImV4cCI6MjA4Mjk0MzQzNX0.rB6KNq-Exe6XTQ3D_UfA67NI2encLqPWJWNWpynB8BQ";

window.sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

window.money = (cents) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

window.mustAuth = async () => {
  const { data } = await sb.auth.getSession();
  if (!data.session) location.href = "./admin-login.html";
  return data.session;
};
