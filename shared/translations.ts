export interface Translation {
  // Authentication
  login: string;
  register: string;
  username: string;
  password: string;
  confirmPassword: string;
  logout: string;
  
  // Navigation
  dashboard: string;
  cards: string;
  transactions: string;
  profile: string;
  nftMarketplace: string;
  
  // Cards
  virtualCard: string;
  cryptoCard: string;
  balance: string;
  cardNumber: string;
  expiryDate: string;
  cvv: string;
  
  // Transactions
  send: string;
  receive: string;
  amount: string;
  recipient: string;
  description: string;
  transferMoney: string;
  
  // Crypto
  btcBalance: string;
  ethBalance: string;
  kichcoinBalance: string;
  btcAddress: string;
  ethAddress: string;
  tonAddress: string;
  seedPhrase: string;
  
  // Settings
  settings: string;
  language: string;
  theme: string;
  notifications: string;
  sound: string;
  
  // Common
  save: string;
  cancel: string;
  confirm: string;
  success: string;
  error: string;
  loading: string;
  copy: string;
  copied: string;
  
  // Status messages
  transactionSuccess: string;
  transactionError: string;
  cardCreated: string;
  profileUpdated: string;
  languageChanged: string;
  
  // Errors
  invalidCredentials: string;
  networkError: string;
  serverError: string;
  validationError: string;
}

export const translations: Record<'ru' | 'en', Translation> = {
  ru: {
    // Authentication
    login: 'Войти',
    register: 'Регистрация',
    username: 'Имя пользователя',
    password: 'Пароль',
    confirmPassword: 'Подтвердите пароль',
    logout: 'Выйти',
    
    // Navigation
    dashboard: 'Главная',
    cards: 'Карты',
    transactions: 'Транзакции',
    profile: 'Профиль',
    nftMarketplace: 'NFT Маркетплейс',
    
    // Cards
    virtualCard: 'Виртуальная карта',
    cryptoCard: 'Крипто карта',
    balance: 'Баланс',
    cardNumber: 'Номер карты',
    expiryDate: 'Срок действия',
    cvv: 'CVV',
    
    // Transactions
    send: 'Отправить',
    receive: 'Получить',
    amount: 'Сумма',
    recipient: 'Получатель',
    description: 'Описание',
    transferMoney: 'Перевести деньги',
    
    // Crypto
    btcBalance: 'BTC баланс',
    ethBalance: 'ETH баланс',
    kichcoinBalance: 'KICHCOIN баланс',
    btcAddress: 'BTC адрес',
    ethAddress: 'ETH адрес',
    tonAddress: 'TON адрес',
    seedPhrase: 'Seed-фраза',
    
    // Settings
    settings: 'Настройки',
    language: 'Язык',
    theme: 'Тема',
    notifications: 'Уведомления',
    sound: 'Звук',
    
    // Common
    save: 'Сохранить',
    cancel: 'Отмена',
    confirm: 'Подтвердить',
    success: 'Успешно',
    error: 'Ошибка',
    loading: 'Загрузка...',
    copy: 'Копировать',
    copied: 'Скопировано',
    
    // Status messages
    transactionSuccess: 'Транзакция выполнена успешно',
    transactionError: 'Ошибка выполнения транзакции',
    cardCreated: 'Карта успешно создана',
    profileUpdated: 'Профиль обновлен',
    languageChanged: 'Язык изменен',
    
    // Errors
    invalidCredentials: 'Неверные учетные данные',
    networkError: 'Ошибка сети',
    serverError: 'Ошибка сервера',
    validationError: 'Ошибка валидации данных'
  },
  
  en: {
    // Authentication
    login: 'Login',
    register: 'Register',
    username: 'Username',
    password: 'Password',
    confirmPassword: 'Confirm Password',
    logout: 'Logout',
    
    // Navigation
    dashboard: 'Dashboard',
    cards: 'Cards',
    transactions: 'Transactions',
    profile: 'Profile',
    nftMarketplace: 'NFT Marketplace',
    
    // Cards
    virtualCard: 'Virtual Card',
    cryptoCard: 'Crypto Card',
    balance: 'Balance',
    cardNumber: 'Card Number',
    expiryDate: 'Expiry Date',
    cvv: 'CVV',
    
    // Transactions
    send: 'Send',
    receive: 'Receive',
    amount: 'Amount',
    recipient: 'Recipient',
    description: 'Description',
    transferMoney: 'Transfer Money',
    
    // Crypto
    btcBalance: 'BTC Balance',
    ethBalance: 'ETH Balance',
    kichcoinBalance: 'KICHCOIN Balance',
    btcAddress: 'BTC Address',
    ethAddress: 'ETH Address',
    tonAddress: 'TON Address',
    seedPhrase: 'Seed Phrase',
    
    // Settings
    settings: 'Settings',
    language: 'Language',
    theme: 'Theme',
    notifications: 'Notifications',
    sound: 'Sound',
    
    // Common
    save: 'Save',
    cancel: 'Cancel',
    confirm: 'Confirm',
    success: 'Success',
    error: 'Error',
    loading: 'Loading...',
    copy: 'Copy',
    copied: 'Copied',
    
    // Status messages
    transactionSuccess: 'Transaction completed successfully',
    transactionError: 'Transaction failed',
    cardCreated: 'Card created successfully',
    profileUpdated: 'Profile updated',
    languageChanged: 'Language changed',
    
    // Errors
    invalidCredentials: 'Invalid credentials',
    networkError: 'Network error',
    serverError: 'Server error',
    validationError: 'Validation error'
  }
};

export function getTranslation(key: keyof Translation, language: 'ru' | 'en' = 'ru'): string {
  return translations[language][key] || translations['ru'][key] || key;
}

export function getCurrentLanguage(): 'ru' | 'en' {
  if (typeof window !== 'undefined') {
    return (localStorage.getItem('language') as 'ru' | 'en') || 'ru';
  }
  return 'ru';
}

export function setLanguage(language: 'ru' | 'en'): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('language', language);
    document.documentElement.setAttribute('lang', language);
  }
}