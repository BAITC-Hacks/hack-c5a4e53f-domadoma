import { test, expect } from '@playwright/test';
test('employee can sign in and see a real profile without access to HR', async ({ page }) => {
  await page.goto('http://127.0.0.1:8765');
  await expect(page.getByRole('heading', { name: 'Твой следующий шаг начинается здесь' })).toBeVisible();
  await page.getByLabel('Логин').fill('employee');
  await page.getByLabel('Пароль').fill(process.env.DEMO_PASSWORD!);
  await page.getByRole('button', { name: 'Войти в Career Quest' }).click();
  await expect(page.getByText('Карта навыков', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Команда и аналитика' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Рекомендовано для тебя' })).toBeVisible();
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page.getByLabel('Пароль')).toBeVisible();
});
