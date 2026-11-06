import { loadEnvFile } from 'node:process'

// .env 是可选文件：不存在时忽略，配置可以全部在应用「设置」页完成。
try {
  loadEnvFile('.env')
} catch {
  // ignore
}
