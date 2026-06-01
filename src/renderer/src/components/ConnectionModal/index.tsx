import React, { useState, useCallback, useMemo } from 'react'
import { X, CheckCircle, AlertCircle, Database } from 'lucide-react'
import { useAppStore, genId } from '../../store'
import type { ConnectionConfig, DatabaseType } from '../../types'
import { DB_DEFAULT_PORTS } from '../../types'
import { parseConnectionUriPreview } from '../../utils/connection-uri'
import { useTranslation } from '../../hooks/useTranslation'

interface Props {
  onClose: () => void
  editConfig?: ConnectionConfig | null
}

interface ConnectionPersistenceActions {
  connect(config: ConnectionConfig): Promise<{ success: boolean; error?: string }>
  saveConnection(config: ConnectionConfig): Promise<void>
}

export async function connectThenSaveConnection(
  config: ConnectionConfig,
  { connect, saveConnection }: ConnectionPersistenceActions
): Promise<{ success: boolean; error?: string }> {
  const result = await connect(config)
  if (!result.success) {
    return result
  }

  await saveConnection(config)
  return result
}

const DB_LOGOS: Record<string, React.JSX.Element> = {
  mysql: (
    <svg viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg" fill="white">
      <path d="M16.405 5.501c-.115 0-.193.014-.274.033v.013h.014c.054.104.146.18.214.273.054.107.1.214.154.32l.014-.015c.094-.066.14-.172.14-.333-.04-.047-.046-.094-.08-.14-.04-.067-.126-.1-.18-.153zM5.77 18.695h-.927a50.854 50.854 0 00-.27-4.41h-.008l-1.41 4.41H2.45l-1.4-4.41h-.01a72.892 72.892 0 00-.195 4.41H0c.055-1.966.192-3.81.41-5.53h1.15l1.335 4.064h.008l1.347-4.064h1.095c.242 2.015.384 3.86.428 5.53zm4.017-4.08c-.378 2.045-.876 3.533-1.492 4.46-.482.716-1.01 1.073-1.583 1.073-.153 0-.34-.046-.566-.138v-.494c.11.017.24.026.386.026.268 0 .483-.075.647-.222.197-.18.295-.382.295-.605 0-.155-.077-.47-.23-.944L6.23 14.615h.91l.727 2.36c.164.536.233.91.205 1.123.4-1.064.678-2.227.835-3.483zm12.325 4.08h-2.63v-5.53h.885v4.85h1.745zm-3.32.135l-1.016-.5c.09-.076.177-.158.255-.25.433-.506.648-1.258.648-2.253 0-1.83-.718-2.746-2.155-2.746-.704 0-1.254.232-1.65.697-.43.508-.646 1.256-.646 2.245 0 .972.19 1.686.574 2.14.35.41.877.615 1.583.615.264 0 .506-.033.725-.098l1.325.772.36-.622zM15.5 17.588c-.225-.36-.337-.94-.337-1.736 0-1.393.424-2.09 1.27-2.09.443 0 .77.167.977.5.224.362.336.936.336 1.723 0 1.404-.424 2.108-1.27 2.108-.445 0-.77-.167-.978-.5zm-1.658-.425c0 .47-.172.856-.516 1.156-.344.3-.803.45-1.384.45-.543 0-1.064-.172-1.573-.515l.237-.476c.438.22.833.328 1.19.328.332 0 .593-.073.783-.22a.754.754 0 00.3-.615c0-.33-.23-.61-.648-.845-.388-.213-1.163-.657-1.163-.657-.422-.307-.632-.636-.632-1.177 0-.45.157-.81.47-1.085.315-.278.72-.415 1.22-.415.512 0 .98.136 1.4.41l-.213.476a2.726 2.726 0 00-1.064-.23c-.283 0-.502.068-.654.206a.685.685 0 00-.248.524c0 .328.234.61.666.85.393.215 1.187.67 1.187.67.433.305.648.63.648 1.168zm9.382-5.852c-.535-.014-.95.04-1.297.188-.1.04-.26.04-.274.167.055.053.063.14.11.214.08.134.218.313.346.407.14.11.28.216.427.31.26.16.555.255.81.416.145.094.293.213.44.313.073.05.12.14.214.172v-.02c-.046-.06-.06-.147-.105-.214-.067-.067-.134-.127-.2-.193a3.223 3.223 0 00-.695-.675c-.214-.146-.682-.35-.77-.595l-.013-.014c.146-.013.32-.066.46-.106.227-.06.435-.047.67-.106.106-.027.213-.06.32-.094v-.06c-.12-.12-.21-.283-.334-.395a8.867 8.867 0 00-1.104-.823c-.21-.134-.476-.22-.697-.334-.08-.04-.214-.06-.26-.127-.12-.146-.19-.34-.275-.514a17.69 17.69 0 01-.547-1.163c-.12-.262-.193-.523-.34-.763-.69-1.137-1.437-1.826-2.586-2.5-.247-.14-.543-.2-.856-.274-.167-.008-.334-.02-.5-.027-.11-.047-.216-.174-.31-.235-.38-.24-1.364-.76-1.644-.072-.18.434.267.862.422 1.082.115.153.26.328.34.5.047.116.06.235.107.356.106.294.207.622.347.897.073.14.153.287.247.413.054.073.146.107.167.227-.094.136-.1.334-.154.5-.24.757-.146 1.693.194 2.25.107.166.362.534.703.393.3-.12.234-.5.32-.835.02-.08.007-.133.048-.187v.015c.094.188.188.367.274.555.206.328.566.668.867.895.16.12.287.328.487.402v-.02h-.015c-.043-.058-.1-.086-.154-.133a3.445 3.445 0 01-.35-.4 8.76 8.76 0 01-.747-1.218c-.11-.21-.202-.436-.29-.643-.04-.08-.04-.2-.107-.24-.1.146-.247.273-.32.453-.127.288-.14.642-.188 1.01-.027.007-.014 0-.027.014-.214-.052-.287-.274-.367-.46-.2-.475-.233-1.238-.06-1.785.047-.14.247-.582.167-.716-.042-.127-.174-.2-.247-.303a2.478 2.478 0 01-.24-.427c-.16-.374-.24-.788-.414-1.162-.08-.173-.22-.354-.334-.513-.127-.18-.267-.307-.368-.52-.033-.073-.08-.194-.027-.274.014-.054.042-.075.094-.09.088-.072.335.022.422.062.247.1.455.194.662.334.094.066.195.193.315.226h.14c.214.047.455.014.655.073.355.114.675.28.962.46a5.953 5.953 0 012.085 2.286c.08.154.115.295.188.455.14.33.313.663.455.982.14.315.275.636.476.897.1.14.502.213.682.286.133.06.34.115.46.188.23.14.454.3.67.454.11.076.443.243.463.378z"/>
    </svg>
  ),
  mariadb: (
    <svg viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg" fill="white">
      <path d="M23.157 4.412c-.676.284-.79.31-1.673.372-.65.045-.757.057-1.212.209-.75.246-1.395.75-2.02 1.59-.296.398-1.249 1.913-1.249 1.988 0 .057-.65.998-.915 1.32-.574.713-1.08 1.079-2.14 1.59-.77.36-1.224.524-4.102 1.477-1.073.353-2.133.738-2.367.864-.852.449-1.515 1.036-2.203 1.938-1.003 1.32-.972 1.313-3.042.947a12.264 12.264 0 00-.675-.063c-.644-.05-1.023.044-1.332.334L0 17.193l.177.088c.094.05.353.234.561.398.215.17.461.347.55.391.088.044.17.088.183.101.012.013-.089.17-.228.353-.435.581-.593.871-.574 1.048.019.164.032.17.43.17.517-.006.826-.056 1.261-.208.65-.233 2.058-.94 2.784-1.4.776-.5 1.717-.998 1.956-1.042.082-.02.354-.07.594-.114.58-.107 1.464-.095 2.587.05.108.013.373.045.6.064.227.025.43.057.454.076.026.012.474.037.998.056.934.026 1.104.007 1.3-.189.126-.133.385-.631.498-.985.209-.643.417-.921.366-.492-.113.966-.322 1.692-.713 2.411-.259.499-.663 1.092-.934 1.395-.322.347-.315.36.088.315.619-.063 1.471-.397 2.096-.82.827-.562 1.647-1.691 2.19-3.03.107-.27.22-.22.183.083-.013.094-.038.315-.057.498l-.031.328.353-.202c.833-.48 1.414-1.262 2.127-2.884.227-.518.877-2.922 1.073-3.976a9.64 9.64 0 01.271-1.042c.127-.429.196-.555.48-.858.183-.19.625-.555.978-.808.72-.505.953-.75 1.187-1.205.208-.417.284-1.13.132-1.357-.132-.202-.284-.196-.763.006Z"/>
    </svg>
  ),
  postgres: (
    <svg viewBox="-4 0 264 264" width="24" height="24" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid">
      <g>
        <path d="M255.007926,158.085617 C253.473109,153.437413 249.452194,150.199279 244.251788,149.42182 C241.799982,149.055852 238.991667,149.211935 235.668988,149.897164 C229.877358,151.092028 225.580342,151.546679 222.44449,151.635363 C234.280794,131.650217 243.905921,108.859714 249.446873,87.4065589 C258.406282,52.7182633 253.61855,36.9154365 248.023797,29.7669469 C233.217182,10.8477783 211.614448,0.683454965 185.55152,0.371879908 C171.649478,0.202198614 159.443658,2.94725173 153.077358,4.92075751 C147.149155,3.87547344 140.774577,3.29134411 134.08606,3.18315012 C121.550337,2.9833164 110.473164,5.71595381 101.008259,11.332582 C95.7670577,9.56127483 87.3580785,7.06335335 77.6460416,5.46882217 C54.8035104,1.71868822 36.3939769,4.64110855 22.9282587,14.153903 C6.62230023,25.6721293 -0.937090069,45.6838799 0.461154734,73.6339954 C0.904572748,82.5082679 5.86908083,109.507695 13.6850624,135.114199 C18.1771824,149.831538 22.9672794,162.053912 27.9223279,171.443732 C34.9490254,184.758688 42.4676212,192.600092 50.9085266,195.415501 C55.6400924,196.992296 64.2358984,198.09552 73.2774873,190.566873 C74.4232794,191.953885 75.9515935,193.33321 77.9812656,194.613801 C80.5578199,196.239076 83.7090439,197.566965 86.8555381,198.353885 C98.1969885,201.189395 108.820102,200.479926 117.882975,196.506309 C117.93855,198.117986 117.981709,199.658125 118.018365,200.987788 C118.07867,203.145164 118.137792,205.259972 118.217016,207.237617 C118.753848,220.612286 119.663741,231.011326 122.359723,238.286928 C122.507529,238.687778 122.706771,239.29733 122.917247,239.943538 C124.261691,244.062005 126.511298,250.955677 132.232573,256.355326 C138.158411,261.947714 145.325229,263.663446 151.888998,263.662855 C155.180933,263.662855 158.322106,263.231261 161.076619,262.640628 C170.897441,260.536462 182.050291,257.329663 190.118134,245.84218 C197.745515,234.981986 201.453672,218.625182 202.124711,192.851363 C202.211621,192.122975 202.292028,191.427104 202.369478,190.763751 C202.421506,190.316194 202.474716,189.858587 202.528517,189.402162 L204.325838,189.560018 L204.788767,189.591353 C214.791095,190.047187 227.021155,187.925875 234.532065,184.437062 C240.467363,181.68255 259.485857,171.642383 255.007926,158.085617" fill="#000000"/>
        <path d="M237.905589,160.722476 C208.165838,166.857016 206.121386,156.78788 206.121386,156.78788 C237.521885,110.194697 250.64824,51.0516028 239.320388,36.5766651 C208.417109,-2.90823095 154.921977,15.7655797 154.029229,16.2503834 L153.741894,16.3018199 C147.866309,15.0821247 141.290716,14.3555104 133.900416,14.2349007 C120.443566,14.0143741 110.236083,17.7627344 102.490457,23.636545 C102.490457,23.636545 7.06039723,-15.6768961 11.4987159,73.0806097 C12.4429007,91.9631224 38.5625866,215.954032 69.7171363,178.502947 C81.1041109,164.808425 92.1061986,153.229303 92.1061986,153.229303 C97.5708822,156.859418 104.112776,158.711132 110.970975,158.046005 L111.503667,157.593718 C111.338125,159.294079 111.413801,160.957192 111.717099,162.925968 C103.691233,171.893062 106.049626,173.467492 90.0055797,176.770069 C73.7711594,180.115806 83.308194,186.072388 89.5349654,187.629081 C97.0837136,189.516859 114.54788,192.190965 126.34812,175.672166 L125.877506,177.556988 C129.022226,180.075603 131.230448,193.940397 130.860342,206.508637 C130.490236,219.077469 130.243104,227.706383 132.720924,234.446337 C135.198744,241.186291 137.668286,256.351187 158.759612,251.831871 C176.383409,248.055132 185.516046,238.268009 186.786587,221.94254 C187.688203,210.336222 189.728517,212.051954 189.857404,201.675381 L191.493912,196.762901 C193.381099,181.029838 191.793663,175.95418 202.651492,178.314938 L205.290125,178.546697 C213.2817,178.9103 223.741044,177.261376 229.879723,174.408129 C243.098309,168.273589 250.93794,158.031224 237.904406,160.722476 L237.905589,160.722476" fill="#336791"/>
        <path d="M108.076342,81.5250624 C105.396915,81.152 102.969349,81.4972748 101.741376,82.426679 C101.050236,82.9499122 100.836804,83.5559169 100.779455,83.973321 C100.625145,85.0783187 101.399649,86.2997875 101.874993,86.9300323 C103.220619,88.7137552 105.18703,89.9399538 107.133339,90.2101432 C107.415353,90.249164 107.695594,90.2680831 107.974651,90.2680831 C111.220471,90.2680831 114.170679,87.7411917 114.430818,85.8758799 C114.755991,83.5399538 111.36473,81.9826697 108.076342,81.5250624" fill="#FFFFFF"/>
        <path d="M196.860453,81.5989654 L196.859861,81.5989654 C196.604453,79.7679446 193.345626,79.2458938 190.253524,79.6757136 C187.166152,80.1061247 184.171603,81.4996397 184.421691,83.3347991 C184.622707,84.7620139 187.19867,87.198448 190.249386,87.1978568 C190.506568,87.1978568 190.766707,87.1807113 191.028619,87.1440554 C193.064794,86.8620416 194.558818,85.5690346 195.268286,84.8235012 C196.349635,83.688351 196.974559,82.4219492 196.860453,81.5989654" fill="#FFFFFF"/>
        <path d="M247.802088,160.025423 C246.66812,156.596323 243.018494,155.492508 236.954309,156.745312 C218.949173,160.461155 212.501284,157.886965 210.38352,156.327908 C224.378975,135.007187 235.89188,109.236323 242.102688,85.1906513 C245.04521,73.8007206 246.670485,63.2231316 246.802919,54.601903 C246.949543,45.1375889 245.338457,38.1842032 242.014005,33.9362587 C228.611547,16.8108637 208.942115,7.62501617 185.131751,7.37256351 C168.763122,7.18869284 154.93321,11.3781062 152.252009,12.5558245 C146.60582,11.1516674 140.450587,10.2896628 133.750245,10.1796952 C121.461654,9.98104388 110.840314,12.9229746 102.045857,18.9191686 C98.2259584,17.4978661 88.3536998,14.10897 76.2814965,12.1644342 C55.4089238,8.80332564 38.8233164,11.3497275 26.9870115,19.7350577 C12.8638522,29.740933 6.34383372,47.626642 7.60727945,72.8943741 C8.03236952,81.3961755 12.8756767,107.547788 20.5202032,132.593219 C30.5822448,165.556915 41.5192979,184.218309 53.0280647,188.056536 C54.374873,188.505866 55.9286097,188.820397 57.6407945,188.820397 C61.8390762,188.820397 66.9856813,186.927889 72.3409885,180.490051 C81.2359538,169.788896 89.5408776,160.821801 92.6022356,157.563566 C97.1262818,159.992314 102.09552,161.347991 107.179455,161.483972 C107.188323,161.616998 107.201921,161.750023 107.213746,161.882457 C106.193885,163.092102 105.357303,164.152166 104.644286,165.05733 C101.122365,169.528166 100.389247,170.458753 89.0519353,172.793497 C85.8273995,173.458624 77.2611547,175.224018 77.1364065,181.227898 C76.9998337,187.787529 87.2605266,190.542633 88.4299677,190.834697 C92.5040924,191.854559 96.4286374,192.357691 100.171677,192.357691 C109.275344,192.357099 117.285838,189.365506 123.688203,183.576831 C123.490734,206.962697 124.466254,230.006836 127.273977,237.028212 C129.573247,242.775501 135.191649,256.822984 152.93842,256.821801 C155.54158,256.821801 158.408425,256.519095 161.561423,255.843326 C180.082106,251.872074 188.124527,243.686577 191.236139,225.640055 C192.901025,215.995418 195.758411,192.963695 197.101672,180.610069 C199.937774,181.49454 203.589173,181.899529 207.536185,181.898938 C215.768388,181.898938 225.266993,180.150097 231.224166,177.384942 C237.91564,174.277469 249.991982,166.650679 247.802088,160.025423 L247.802088,160.025423 Z" fill="#FFFFFF"/>
      </g>
    </svg>
  ),
  sqlite: (
    <svg viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg" fill="white">
      <path d="M21.678.521c-1.032-.92-2.28-.55-3.513.544a8.71 8.71 0 0 0-.547.535c-2.109 2.237-4.066 6.38-4.674 9.544.237.48.422 1.093.544 1.561a13.044 13.044 0 0 1 .164.703s-.019-.071-.096-.296l-.05-.146a1.689 1.689 0 0 0-.033-.08c-.138-.32-.518-.995-.686-1.289-.143.423-.27.818-.376 1.176.484.884.778 2.4.778 2.4s-.025-.099-.147-.442c-.107-.303-.644-1.244-.772-1.464-.217.804-.304 1.346-.226 1.478.152.256.296.698.422 1.186.286 1.1.485 2.44.485 2.44l.017.224a22.41 22.41 0 0 0 .056 2.748c.095 1.146.273 2.13.5 2.657l.155-.084c-.334-1.038-.47-2.399-.41-3.967.09-2.398.642-5.29 1.661-8.304 1.723-4.55 4.113-8.201 6.3-9.945-1.993 1.8-4.692 7.63-5.5 9.788-.904 2.416-1.545 4.684-1.931 6.857.666-2.037 2.821-2.912 2.821-2.912s1.057-1.304 2.292-3.166c-.74.169-1.955.458-2.362.629-.6.251-.762.337-.762.337s1.945-1.184 3.613-1.72C21.695 7.9 24.195 2.767 21.678.521m-18.573.543A1.842 1.842 0 0 0 1.27 2.9v16.608a1.84 1.84 0 0 0 1.835 1.834h9.418a22.953 22.953 0 0 1-.052-2.707c-.006-.062-.011-.141-.016-.2a27.01 27.01 0 0 0-.473-2.378c-.121-.47-.275-.898-.369-1.057-.116-.197-.098-.31-.097-.432 0-.12.015-.245.037-.386a9.98 9.98 0 0 1 .234-1.045l.217-.028c-.017-.035-.014-.065-.031-.097l-.041-.381a32.8 32.8 0 0 1 .382-1.194l.2-.019c-.008-.016-.01-.038-.018-.053l-.043-.316c.63-3.28 2.587-7.443 4.8-9.791.066-.069.133-.128.198-.194Z"/>
    </svg>
  ),
  mssql: (
    <svg viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="12" cy="5" rx="9" ry="3" fill="white"/>
      <path d="M3 5v5c0 1.66 4.03 3 9 3s9-1.34 9-3V5" fill="none" stroke="white" strokeWidth="1.5"/>
      <path d="M3 10v5c0 1.66 4.03 3 9 3s9-1.34 9-3v-5" fill="none" stroke="white" strokeWidth="1.5"/>
      <path d="M3 15v4c0 1.66 4.03 3 9 3s9-1.34 9-3v-4" fill="none" stroke="white" strokeWidth="1.5"/>
    </svg>
  ),
  mongodb: (
    <svg viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg" fill="white">
      <path d="M12.4 22.5c-.3-.9-.5-2.3-.5-3.8 0-2.3.4-4.7 1.3-7.1.8-2.3 2.1-4.9 3.8-7.7-2.4 2.1-4.3 4.7-5.7 7.7-1.2 2.8-1.8 5.4-1.8 7.8 0 1.1.1 2 .4 2.8C6.8 19.9 5.2 16.9 5.2 13c0-3.2 1.2-6 3.6-8.4C10.4 3 12.1 2 14 1.5c.7 1.5 1.4 3.5 1.8 5.8.4 2.4.4 4.6-.1 6.7-.7 3.4-1.8 6.2-3.3 8.5Z"/>
    </svg>
  )
}

const DB_TYPES: { value: DatabaseType; label: string; color: string }[] = [
  { value: 'mysql', label: 'MySQL', color: '#f97316' },
  { value: 'mariadb', label: 'MariaDB', color: '#c084fc' },
  { value: 'postgres', label: 'PostgreSQL', color: '#1a1a2e' },
  { value: 'sqlite', label: 'SQLite', color: '#0f80cc' },
  { value: 'mssql', label: 'SQL Server', color: '#f87171' },
  { value: 'mongodb', label: 'MongoDB', color: '#10b981' }
]

const defaultConfig = (): Omit<ConnectionConfig, 'id'> => ({
  name: '',
  type: 'mysql',
  connectionUri: '',
  host: 'localhost',
  port: 3306,
  user: '',
  password: '',
  database: '',
  filename: '',
  ssl: false,
  color: '#f97316'
})

export function ConnectionModal({ onClose, editConfig }: Props): React.JSX.Element {
  const { saveConnection, connect, connections } = useAppStore()
  const { t } = useTranslation()

  const [config, setConfig] = useState<Omit<ConnectionConfig, 'id'>>(() =>
    editConfig ? { ...editConfig } : defaultConfig()
  )
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null)
  const [saving, setSaving] = useState(false)

  // Collect distinct existing categories for the datalist
  const existingCategories = useMemo(() => {
    const cats = new Set<string>()
    for (const conn of connections) {
      if (conn.category?.trim()) cats.add(conn.category.trim())
    }
    return Array.from(cats).sort()
  }, [connections])

  const isSQLite = config.type === 'sqlite'
  const [connectionMode, setConnectionMode] = useState<'manual' | 'uri'>(
    !isSQLite && !!config.connectionUri?.trim() ? 'uri' : 'manual'
  )

  const uriPreview = !isSQLite ? parseConnectionUriPreview(config.type, config.connectionUri) : {}
  const uriModeInvalid = !isSQLite && connectionMode === 'uri' && !!uriPreview.error
  const uriModeMissing = !isSQLite && connectionMode === 'uri' && !(config.connectionUri ?? '').trim()
  const disableConnectActions = uriModeInvalid || uriModeMissing

  const handleTypeChange = (type: DatabaseType) => {
    const dbType = DB_TYPES.find((d) => d.value === type)
    setConfig((prev) => ({
      ...prev,
      type,
      port: DB_DEFAULT_PORTS[type] ?? prev.port,
      color: dbType?.color ?? prev.color
    }))
    setConnectionMode((prev) => (type === 'sqlite' ? 'manual' : prev))
    setTestResult(null)
  }

  const update = (field: keyof Omit<ConnectionConfig, 'id'>, value: unknown) => {
    setConfig((prev) => ({ ...prev, [field]: value }))
    setTestResult(null)
  }

  const handleTest = useCallback(async () => {
    if (disableConnectActions) {
      setTestResult({ success: false, error: uriModeMissing ? 'Connection URI is required' : uriPreview.error })
      return
    }

    setTesting(true)
    setTestResult(null)
    const fullConfig: ConnectionConfig = { id: editConfig?.id ?? genId(), ...config }
    const result = await window.db.testConnection(fullConfig)
    setTestResult({
      success: result.success,
      error: result.success ? undefined : (result.error || 'Connection failed')
    })
    setTesting(false)
  }, [config, editConfig, disableConnectActions, uriModeMissing, uriPreview.error])

  const handleSave = useCallback(async () => {
    if (!config.name.trim()) {
      setTestResult({ success: false, error: 'Connection name is required' })
      return
    }
    if (disableConnectActions) {
      setTestResult({ success: false, error: uriModeMissing ? 'Connection URI is required' : uriPreview.error })
      return
    }

    setSaving(true)
    try {
      const normalizedCategory = config.category?.trim()
      const fullConfig: ConnectionConfig = {
        id: editConfig?.id ?? genId(),
        ...config,
        category: normalizedCategory || undefined
      }
      const result = await connectThenSaveConnection(fullConfig, { connect, saveConnection })
      if (result.success) {
        onClose()
      } else {
        setTestResult({ success: false, error: result.error || 'Connection failed' })
      }
    } catch (err) {
      setTestResult({ success: false, error: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }, [config, editConfig, saveConnection, connect, setTestResult, onClose, disableConnectActions, uriModeMissing, uriPreview.error])

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel">
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              background: 'linear-gradient(135deg, var(--accent), #a78bfa)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Database size={16} color="white" />
            </div>
            <span className="modal-title">
              {editConfig ? t('connection.editTitle') : t('connection.newTitle')}
            </span>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">{t('connection.dbType')}</label>
            <div className="db-type-grid">
              {DB_TYPES.map((db) => (
                <div
                  key={db.value}
                  className={`db-type-card ${config.type === db.value ? 'selected' : ''}`}
                  onClick={() => handleTypeChange(db.value)}
                >
                  <div className="db-type-icon" style={{ background: db.color }}>
                    {DB_LOGOS[db.value]}
                  </div>
                  <span className="db-type-label">{db.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">{t('connection.name')}</label>
            <input
              className="form-input"
              type="text"
              value={config.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder={`My ${DB_TYPES.find((d) => d.value === config.type)?.label} DB`}
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label">{t('connection.category')}</label>
            <input
              className="form-input"
              type="text"
              list="category-suggestions"
              value={config.category ?? ''}
              onChange={(e) => update('category', e.target.value || undefined)}
              placeholder="e.g. Production, Staging, Local…"
            />
            {existingCategories.length > 0 && (
              <datalist id="category-suggestions">
                {existingCategories.map((cat) => (
                  <option key={cat} value={cat} />
                ))}
              </datalist>
            )}
          </div>

          {!isSQLite && (
            <div className="form-group">
              <label className="form-label">{t('connection.method')}</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className={`btn ${connectionMode === 'manual' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setConnectionMode('manual')}
                >
                  {t('connection.manual')}
                </button>
                <button
                  type="button"
                  className={`btn ${connectionMode === 'uri' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setConnectionMode('uri')}
                >
                  {t('connection.uri')}
                </button>
              </div>
            </div>
          )}

          {isSQLite ? (
            <div className="form-group">
              <label className="form-label">{t('connection.file')}</label>
              <input
                className="form-input"
                type="text"
                value={config.filename ?? ''}
                onChange={(e) => update('filename', e.target.value)}
                placeholder="/path/to/database.db (leave empty for in-memory)"
              />
            </div>
          ) : connectionMode === 'uri' ? (
            <>
              <div className="form-group">
                <label className="form-label">{t('connection.uri')}</label>
                <input
                  className="form-input"
                  type="text"
                  value={config.connectionUri ?? ''}
                  onChange={(e) => update('connectionUri', e.target.value)}
                  placeholder={
                    config.type === 'postgres'
                      ? 'postgresql://user:pass@host:5432/db'
                      : config.type === 'mssql'
                        ? 'mssql://user:pass@host:1433/db'
                        : config.type === 'mongodb'
                          ? 'mongodb://user:pass@host:27017/db' // betterleaks:allow - placeholder URI
                          : 'mysql://user:pass@host:3306/db'
                  }
                />
                <div style={{ marginTop: 6, fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
                  URI credentials can be copied/shared by mistake. Prefer dedicated password fields when possible.
                </div>
              </div>
              {uriPreview.error ? (
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-error)' }}>{uriPreview.error}</div>
              ) : uriPreview.parsed ? (
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
                  Parsed: host <strong>{uriPreview.parsed.host ?? '-'}</strong>, port{' '}
                  <strong>{uriPreview.parsed.port ?? '-'}</strong>, user <strong>{uriPreview.parsed.user ?? '-'}</strong>,
                  database <strong>{uriPreview.parsed.database ?? '-'}</strong>
                  {uriPreview.parsed.ssl !== undefined ? (
                    <>
                      , ssl <strong>{uriPreview.parsed.ssl ? 'enabled' : 'disabled'}</strong>
                    </>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">{t('connection.host')}</label>
                  <input
                    className="form-input"
                    type="text"
                    value={config.host ?? ''}
                    onChange={(e) => update('host', e.target.value)}
                    placeholder="localhost"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">{t('connection.port')}</label>
                  <input
                    className="form-input"
                    type="number"
                    value={config.port ?? ''}
                    onChange={(e) => update('port', parseInt(e.target.value) || undefined)}
                    placeholder={String(DB_DEFAULT_PORTS[config.type] ?? '')}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">{t('connection.user')}</label>
                  <input
                    className="form-input"
                    type="text"
                    value={config.user ?? ''}
                    onChange={(e) => update('user', e.target.value)}
                    placeholder="username"
                    autoComplete="username"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">{t('connection.password')}</label>
                  <input
                    className="form-input"
                    type="password"
                    value={config.password ?? ''}
                    onChange={(e) => update('password', e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">{t('connection.database')}</label>
                <input
                  className="form-input"
                  type="text"
                  value={config.database ?? ''}
                  onChange={(e) => update('database', e.target.value)}
                  placeholder="database name"
                />
              </div>

              <label className="form-checkbox-row">
                <input
                  type="checkbox"
                  checked={config.ssl ?? false}
                  onChange={(e) => update('ssl', e.target.checked)}
                />
                <span className="form-checkbox-label">{t('connection.ssl')}</span>
              </label>
            </>
          )}

          {testResult && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                background: testResult.success
                  ? 'rgba(74, 222, 128, 0.1)'
                  : 'rgba(248, 113, 113, 0.1)',
                border: `1px solid ${testResult.success ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'}`,
                fontSize: 'var(--font-size-sm)',
                color: testResult.success ? 'var(--color-success)' : 'var(--color-error)'
              }}
            >
              {testResult.success ? (
                <CheckCircle size={14} />
              ) : (
                <AlertCircle size={14} />
              )}
              {testResult.success ? 'Connection successful!' : testResult.error ?? 'Connection failed'}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={handleTest} disabled={testing}>
            {testing ? <><span className="spinner" style={{ width: 12, height: 12 }} /> {t('connection.testing')}</> : t('connection.test')}
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={onClose}>{t('settings.cancel')}</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || disableConnectActions}>
            {saving ? <span className="spinner" style={{ width: 12, height: 12 }} /> : null}
            {editConfig ? t('connection.update') : t('connection.connect')}
          </button>
        </div>
      </div>
    </div>
  )
}
