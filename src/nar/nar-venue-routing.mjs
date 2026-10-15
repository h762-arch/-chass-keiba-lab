// The snapshot field is hashed. Absence preserves the original reader contract.
export const NAR_VENUE_ROUTING_VERSION='NAR_VENUE_ROUTING_22_23_V1';
const legacy=Object.freeze({10:'盛岡',11:'水沢',18:'浦和',19:'船橋',20:'大井',21:'川崎',22:'笠松',23:'金沢',24:'名古屋',27:'園田',28:'姫路',31:'高知',32:'佐賀',36:'門別'});
const current=Object.freeze({...legacy,22:'金沢',23:'笠松'});
export function snapshotNarTrackCode(data){
 const present=Object.hasOwn(data,'venueRoutingVersion');
 const table=!present?legacy:data.venueRoutingVersion===NAR_VENUE_ROUTING_VERSION?current:null;
 return table?Object.keys(table).find(k=>table[k]===data.race?.track):undefined;
}
export function narMeetingRoutingVerified(item){
 return !['金沢','笠松'].includes(item?.track)||item?.venueRoutingVersion===NAR_VENUE_ROUTING_VERSION;
}
