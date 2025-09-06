#!/bin/bash
# Скрипт для перезапуска сервера и NFT сервера

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔄 Перезапуск серверов...${NC}"

# Остановка всех процессов Node.js
echo -e "${YELLOW}⚠️ Останавливаем все процессы Node.js...${NC}"
pkill -f "node" || true
sleep 1

# Проверка, что все процессы остановлены
NODE_PROCESSES=$(pgrep -f "node" | wc -l)
if [ "$NODE_PROCESSES" -gt 0 ]; then
  echo -e "${YELLOW}⚠️ Принудительно останавливаем оставшиеся процессы Node.js...${NC}"
  pkill -9 -f "node" || true
  sleep 1
fi

# Проверка после принудительной остановки
NODE_PROCESSES=$(pgrep -f "node" | wc -l)
if [ "$NODE_PROCESSES" -gt 0 ]; then
  echo -e "${RED}❌ Не удалось остановить все процессы Node.js${NC}"
  echo -e "${RED}❌ Пожалуйста, перезапустите Replit вручную${NC}"
  exit 1
else
  echo -e "${GREEN}✅ Все процессы Node.js остановлены${NC}"
fi

# Создание сигнального файла для перезапуска
echo $(date) > .restart_signal
echo -e "${GREEN}✅ Создан сигнал перезапуска${NC}"

# Запускаем сервер с помощью скрипта для Replit
echo -e "${BLUE}🚀 Запускаем сервер через start-replit.sh...${NC}"
bash start-replit.sh