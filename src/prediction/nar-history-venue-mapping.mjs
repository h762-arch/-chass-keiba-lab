// Historical hash reconstruction uses the original table only when the field is absent.
// This module versions History identity matching; it does not route live acquisition.
const legacy=Object.freeze({3:'帯広',10:'盛岡',11:'水沢',18:'浦和',19:'船橋',20:'大井',21:'川崎',22:'笠松',23:'金沢',24:'名古屋',27:'園田',28:'姫路',31:'高知',32:'佐賀',36:'門別'});
export const CURRENT_NAR_HISTORY_VENUE_VERSION='NAR_HISTORY_VENUES_22_23_V1';
const current=Object.freeze({...legacy,22:'金沢',23:'笠松'});
export function narHistoryVenues(version){
 return version===undefined?legacy:version===CURRENT_NAR_HISTORY_VENUE_VERSION?current:null;
}
