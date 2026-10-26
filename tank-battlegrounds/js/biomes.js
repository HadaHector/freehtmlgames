// A biome drives both the strategy-map tile colour and the look of the battlefield.
export const BIOMES = {
  meadow: { name: 'Meadow', map: '#6a9a3f', sky: ['#2b6cb0', '#a8d8f0'], soil: ['#6a8f3a', '#7a5a35', '#3a2a1a'], edge: '#8fc24a', decor: ['tree', 'tree', 'bush'], clouds: true, rock: '#8a8a8a' },
  alps:   { name: 'Alps',   map: '#8a8f96', sky: ['#3b4a7a', '#c9b6d9'], soil: ['#8a8f96', '#5f646b', '#33373c'], edge: '#f2f5f8', decor: ['pine', 'pine', 'rock'], clouds: true, rock: '#7a7f86' },
  desert: { name: 'Desert', map: '#d9b36a', sky: ['#d9772f', '#f7d9a0'], soil: ['#e0b565', '#c28a45', '#7a4d26'], edge: '#f0cf84', decor: ['cactus', 'rock'], sun: true, rock: '#a8743a' },
  arctic: { name: 'Arctic', map: '#dbe6ee', sky: ['#5a7fa8', '#dbe9f4'], soil: ['#e8eef4', '#9fb4c8', '#4a5a6a'], edge: '#ffffff', decor: ['pine', 'rock'], clouds: true, rock: '#9aa4ae' },
};
