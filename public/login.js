(function initLoginPage() {
  'use strict';

  const form = document.getElementById('loginForm');
  const username = document.getElementById('username');
  const password = document.getElementById('password');
  const errorBox = document.getElementById('loginError');
  const submit = document.getElementById('loginSubmit');
  const authClient = WorkbenchAuth.createAuthClient();

  async function redirectAuthenticatedUser() {
    try {
      await authClient.me();
      location.replace('/');
    } catch (error) {
      if (error.status !== 401) errorBox.textContent = '暂时无法连接工作台，请稍后重试。';
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.textContent = '';
    if (!username.value.trim() || !password.value) {
      errorBox.textContent = '请输入用户名和密码。';
      return;
    }

    submit.disabled = true;
    submit.textContent = '正在登录…';
    try {
      await authClient.login(username.value.trim(), password.value);
      location.replace('/');
    } catch (error) {
      errorBox.textContent = error.status === 429
        ? '尝试次数过多，请稍后再试。'
        : '用户名或密码不正确。';
      password.value = '';
      password.focus();
    } finally {
      submit.disabled = false;
      submit.textContent = '登录';
    }
  });

  redirectAuthenticatedUser();
})();
